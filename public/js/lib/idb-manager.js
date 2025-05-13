/**
 * IndexedDB Manager for CodiMD offline support
 * 管理离线笔记内容和操作队列
 */

class IDBManager {
  constructor() {
    this.DB_NAME = 'codimd-offline';
    this.DB_VERSION = 1;
    this.NOTES_STORE = 'notes';
    this.OPERATIONS_STORE = 'operations';
    this.db = null;
    this.initPromise = this._init();
    
    // 注册自动保存功能
    this._setupAutoSave();
  }

  /**
   * 初始化IndexedDB
   */
  async _init() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        return resolve(this.db);
      }

      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // 创建笔记存储
        if (!db.objectStoreNames.contains(this.NOTES_STORE)) {
          const noteStore = db.createObjectStore(this.NOTES_STORE, { keyPath: 'id' });
          noteStore.createIndex('lastModified', 'lastModified', { unique: false });
        }
        
        // 创建操作队列存储
        if (!db.objectStoreNames.contains(this.OPERATIONS_STORE)) {
          const opStore = db.createObjectStore(this.OPERATIONS_STORE, { 
            keyPath: 'id', 
            autoIncrement: true 
          });
          opStore.createIndex('noteId', 'noteId', { unique: false });
          opStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log('IndexedDB initialized successfully');
        resolve(this.db);
      };
    });
  }
  
  /**
   * 设置自动保存功能
   * 定期将当前编辑器内容保存到IndexedDB
   */
  _setupAutoSave() {
    // 当前是否处于离线模式
    let isOffline = false;
    
    // 监听网络状态变化
    window.addEventListener('online', () => {
      isOffline = false;
    });
    
    window.addEventListener('offline', () => {
      isOffline = true;
    });
    
    // 初始状态检查
    isOffline = !navigator.onLine;
    
    // 定期自动保存
    setInterval(() => {
      // 如果在离线状态且编辑器存在，自动保存当前内容
      if (isOffline && window.editor && window.noteid) {
        const content = window.editor.getValue();
        this.saveNoteSnapshot(window.noteid, content)
          .then(() => console.log('离线模式: 已自动保存文档内容'))
          .catch(err => console.error('离线模式: 自动保存失败', err));
      }
    }, 30000); // 每30秒自动保存一次
  }

  /**
   * 保存笔记内容快照
   */
  async saveNoteSnapshot(noteId, content, metadata = {}) {
    await this.initPromise;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.NOTES_STORE], 'readwrite');
      const store = transaction.objectStore(this.NOTES_STORE);
      
      const note = {
        id: noteId,
        content: content,
        metadata: metadata,
        lastModified: new Date().getTime()
      };
      
      const request = store.put(note);
      
      request.onerror = (event) => {
        console.error('Error saving note snapshot:', event.target.error);
        reject(event.target.error);
      };
      
      request.onsuccess = (event) => {
        resolve(event.target.result);
      };
    });
  }

  /**
   * 获取笔记内容快照
   */
  async getNoteSnapshot(noteId) {
    await this.initPromise;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.NOTES_STORE], 'readonly');
      const store = transaction.objectStore(this.NOTES_STORE);
      
      const request = store.get(noteId);
      
      request.onerror = (event) => {
        console.error('Error getting note snapshot:', event.target.error);
        reject(event.target.error);
      };
      
      request.onsuccess = (event) => {
        if (event.target.result) {
          resolve(event.target.result);
        } else {
          resolve(null);
        }
      };
    });
  }

  /**
   * 将操作添加到队列
   */
  async queueOperation(noteId, operation, metadata = {}) {
    await this.initPromise;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.OPERATIONS_STORE], 'readwrite');
      const store = transaction.objectStore(this.OPERATIONS_STORE);
      
      const op = {
        noteId: noteId,
        operation: operation,
        metadata: metadata,
        timestamp: new Date().getTime(),
        synced: false
      };
      
      const request = store.add(op);
      
      request.onerror = (event) => {
        console.error('Error queuing operation:', event.target.error);
        reject(event.target.error);
      };
      
      request.onsuccess = (event) => {
        resolve(event.target.result);
        
        // 操作添加后，保存当前笔记的完整状态作为备份
        if (window.editor && window.editor.getValue) {
          const content = window.editor.getValue();
          this.saveNoteSnapshot(noteId, content, { autoSaved: true })
            .catch(err => console.error('自动保存备份失败:', err));
        }
      };
    });
  }

  /**
   * 获取笔记的待处理操作队列
   */
  async getPendingOperations(noteId) {
    await this.initPromise;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.OPERATIONS_STORE], 'readonly');
      const store = transaction.objectStore(this.OPERATIONS_STORE);
      const index = store.index('noteId');
      
      const request = index.getAll(noteId);
      
      request.onerror = (event) => {
        console.error('Error getting pending operations:', event.target.error);
        reject(event.target.error);
      };
      
      request.onsuccess = (event) => {
        // 按时间戳排序，确保操作按正确顺序应用
        const operations = event.target.result.sort((a, b) => a.timestamp - b.timestamp);
        resolve(operations);
      };
    });
  }

  /**
   * 检查是否有待处理操作
   */
  async hasPendingOperations(noteId) {
    const ops = await this.getPendingOperations(noteId);
    return ops && ops.length > 0;
  }

  /**
   * 清除已同步的操作
   */
  async clearPendingOperations(noteId, operationIds = null) {
    await this.initPromise;
    
    return new Promise(async (resolve, reject) => {
      const transaction = this.db.transaction([this.OPERATIONS_STORE], 'readwrite');
      const store = transaction.objectStore(this.OPERATIONS_STORE);
      
      try {
        if (operationIds && operationIds.length > 0) {
          // 清除指定ID的操作
          for (const id of operationIds) {
            await new Promise((res, rej) => {
              const request = store.delete(id);
              request.onsuccess = res;
              request.onerror = rej;
            });
          }
        } else {
          // 清除所有与noteId相关的操作
          const index = store.index('noteId');
          const request = index.getAll(noteId);
          
          request.onsuccess = async (event) => {
            const operations = event.target.result;
            for (const op of operations) {
              await new Promise((res, rej) => {
                const delRequest = store.delete(op.id);
                delRequest.onsuccess = res;
                delRequest.onerror = rej;
              });
            }
            resolve();
          };
          
          request.onerror = (event) => {
            reject(event.target.error);
          };
          return; // 防止提前resolve
        }
        
        resolve();
      } catch (err) {
        console.error('Error clearing operations:', err);
        reject(err);
      }
    });
  }

  /**
   * 保存当前编辑器状态（内容和元数据）
   */
  async saveEditorState(noteId, content, cmRevision, lastInfo) {
    await this.saveNoteSnapshot(noteId, content, {
      revision: cmRevision,
      lastInfo: lastInfo,
      savedAt: new Date().toISOString()
    });
  }

  /**
   * 恢复编辑器状态
   */
  async restoreEditorState(noteId) {
    const snapshot = await this.getNoteSnapshot(noteId);
    if (!snapshot) return null;
    
    return {
      content: snapshot.content,
      metadata: snapshot.metadata
    };
  }

  /**
   * 清除数据库中的所有数据
   */
  async clearAll() {
    await this.initPromise;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.NOTES_STORE, this.OPERATIONS_STORE], 'readwrite');
      
      const noteStore = transaction.objectStore(this.NOTES_STORE);
      const opStore = transaction.objectStore(this.OPERATIONS_STORE);
      
      noteStore.clear();
      opStore.clear();
      
      transaction.oncomplete = () => {
        resolve();
      };
      
      transaction.onerror = (event) => {
        reject(event.target.error);
      };
    });
  }
}

export default IDBManager; 