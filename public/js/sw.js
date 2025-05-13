/**
 * CodiMD Service Worker 
 * 用于应用缓存和离线功能支持
 */

const CACHE_NAME = 'codimd-offline-v1';

// 需要缓存的核心资源
const CORE_ASSETS = [
  '/',
  '/css/index.css',
  '/css/extra.css',
  '/css/site.css',
  '/css/slide-preview.css',
  '/js/index.js',
  '/js/lib/idb-manager.js',
  '/vendor/showup/showup.js',
  '/js/lib/common/login.js',
  '/js/extra.js',
  '/js/lib/syncscroll.js',
  '/js/history.js',
  '/js/render.js',
  '/js/lib/editor.js',
  // 添加必要的emojify资源
  '/js/emojify-browser.min.js',
  '/css/emojify.min.css',
  '/images/emoji/',
  // 添加其他可能需要的资源
  '/js/reveal-markdown.js',
  '/vendor/reveal.js/js/reveal.js',
  '/vendor/reveal.js/css/reveal.css',
  '/vendor/reveal.js/css/theme/white.css',
  '/vendor/reveal.js/lib/js/head.min.js',
  // 添加字体和图标
  '/vendor/fontawesome/css/font-awesome.min.css',
  '/vendor/bootstrap/dist/css/bootstrap.min.css',
  '/vendor/jquery/dist/jquery.min.js',
  '/vendor/bootstrap/dist/js/bootstrap.min.js',
  '/vendor/codemirror/lib/codemirror.css'
];

// 安装事件 - 预缓存核心资源
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] 安装中...');
  
  // 跳过等待，确保新SW立即激活
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] 预缓存应用外壳...');
        return cache.addAll(CORE_ASSETS);
      })
      .catch((error) => {
        console.error('[ServiceWorker] 预缓存失败:', error);
      })
  );
});

// 激活事件 - 清理旧缓存
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] 激活中...');
  
  // 接管控制权，确保SW立即控制页面
  self.clients.claim();
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('[ServiceWorker] 删除旧缓存:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
  );
});

// 资源获取策略
self.addEventListener('fetch', (event) => {
  // 排除Socket.IO请求
  if (event.request.url.includes('/socket.io/')) {
    return;
  }
  
  // 对于API请求，需要特殊处理
  if (event.request.url.includes('/api/')) {
    // 对于GET请求，尝试从网络获取，失败时从缓存读取
    if (event.request.method === 'GET') {
      event.respondWith(
        fetch(event.request)
          .then(response => {
            // 如果成功，缓存响应
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
            return response;
          })
          .catch(() => {
            // 网络失败时，尝试从缓存读取
            return caches.match(event.request);
          })
      );
    }
    return;
  }
  
  // 对于GET请求使用缓存优先策略
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.open(CACHE_NAME)
        .then((cache) => {
          return cache.match(event.request)
            .then((cachedResponse) => {
              // 有缓存则返回缓存
              if (cachedResponse) {
                // 后台更新缓存
                updateCache(event.request, cache);
                return cachedResponse;
              }
              
              // 无缓存则从网络获取
              return fetch(event.request)
                .then((networkResponse) => {
                  // 缓存网络响应
                  if (networkResponse.status === 200) {
                    cache.put(event.request, networkResponse.clone());
                  }
                  return networkResponse;
                })
                .catch((error) => {
                  console.error('[ServiceWorker] 网络请求失败:', event.request.url, error);
                  
                  // 处理特定资源类型
                  const url = event.request.url;
                  
                  // 处理JS文件
                  if (url.endsWith('.js')) {
                    return new Response('console.log("[ServiceWorker] 提供了兜底JS响应");', {
                      headers: { 'Content-Type': 'application/javascript' }
                    });
                  }
                  
                  // 处理CSS文件
                  if (url.endsWith('.css')) {
                    return new Response('/* [ServiceWorker] 提供了兜底CSS响应 */', {
                      headers: { 'Content-Type': 'text/css' }
                    });
                  }
                  
                  // 处理图片
                  if (url.match(/\.(jpg|jpeg|png|gif|bmp|webp)$/i)) {
                    return new Response(new Uint8Array([]), {
                      headers: { 'Content-Type': 'image/png' }
                    });
                  }
                  
                  // 处理笔记页面请求
                  if (url.includes('/notes/') || url.includes('/p/')) {
                    return caches.match('/');
                  }
                  
                  // 其他资源
                  return new Response('/* [ServiceWorker] 离线模式，资源不可用 */', {
                    headers: { 'Content-Type': 'text/plain' }
                  });
                });
            });
        })
    );
  }
});

// 后台同步事件
self.addEventListener('sync', (event) => {
  console.log('[ServiceWorker] 同步事件:', event.tag);
  
  if (event.tag === 'sync-note-operations') {
    event.waitUntil(syncNoteOperations());
  }
});

// 消息事件处理
self.addEventListener('message', (event) => {
  console.log('[ServiceWorker] 收到消息:', event.data);
  
  if (event.data && event.data.type === 'SYNC_OPERATIONS') {
    // 通知主线程操作同步的状态
    syncNoteOperations(event.data.noteId).then(() => {
      event.source.postMessage({
        type: 'SYNC_COMPLETE',
        noteId: event.data.noteId
      });
    }).catch((error) => {
      event.source.postMessage({
        type: 'SYNC_ERROR',
        noteId: event.data.noteId,
        error: error.message
      });
    });
  } else if (event.data && event.data.type === 'CACHE_NOTE') {
    // 缓存特定笔记内容
    cacheNote(event.data.noteId, event.data.content).then(() => {
      event.source.postMessage({
        type: 'NOTE_CACHED',
        noteId: event.data.noteId
      });
    });
  }
});

// 后台更新缓存的辅助函数
function updateCache(request, cache) {
  fetch(request)
    .then((response) => {
      if (response.status === 200) {
        cache.put(request, response);
      }
    })
    .catch((error) => {
      console.log('[ServiceWorker] 后台更新缓存失败:', error);
    });
}

// 辅助函数: 同步笔记操作
async function syncNoteOperations(noteId) {
  // 实际同步逻辑在主线程中处理
  // 这里只是通知所有客户端尝试同步
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'TRY_SYNC_OPERATIONS',
      noteId: noteId
    });
  });
}

// 辅助函数: 缓存笔记内容
async function cacheNote(noteId, content) {
  const cache = await caches.open(CACHE_NAME);
  const noteUrl = `/notes/${noteId}`;
  
  // 创建一个基本的HTML响应
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>离线笔记 - ${noteId}</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta name="note-content" content="${encodeURIComponent(content)}">
    </head>
    <body>
      <div id="note-content" data-note-id="${noteId}">
        ${content}
      </div>
      <script>
        // 离线笔记数据载入脚本
        window.offlineNoteId = "${noteId}";
        window.offlineNoteContent = "${encodeURIComponent(content)}";
      </script>
    </body>
    </html>
  `;
  
  const response = new Response(htmlContent, {
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache'
    }
  });
  
  await cache.put(noteUrl, response);
  console.log(`[ServiceWorker] 已缓存笔记 ${noteId}`);
} 