/* eslint-env browser, jquery */
/* global CodeMirror, Cookies, moment, serverurl,
   key, Dropbox, ot, hex2rgb, Visibility, inlineAttachment */

import TurndownService from 'turndown'

import { saveAs } from 'file-saver'
import randomColor from 'randomcolor'
import store from 'store'
import hljs from 'highlight.js'

import isURL from 'validator/lib/isURL'

import _ from 'lodash'

import wurl from 'wurl'

import List from 'list.js'

import Idle from '@hackmd/idle-js'

import { Spinner } from 'spin.js'

import {
  checkLoginStateChanged,
  setloginStateChangeEvent
} from './lib/common/login'

import {
  debug,
  DROPBOX_APP_KEY,
  noteid,
  noteurl,
  urlpath,
  version
} from './lib/config'

import {
  autoLinkify,
  deduplicatedHeaderId,
  exportToHTML,
  exportToRawHTML,
  removeDOMEvents,
  finishView,
  generateToc,
  md,
  parseMeta,
  postProcess,
  renderFilename,
  renderTOC,
  renderTags,
  renderTitle,
  scrollToHash,
  smoothHashScroll,
  updateLastChange,
  updateLastChangeUser,
  updateOwner
} from './extra'

import {
  clearMap,
  setupSyncAreas,
  syncScrollToEdit,
  syncScrollToView
} from './lib/syncscroll'

import {
  writeHistory,
  deleteServerHistory,
  getHistory,
  saveHistory,
  removeHistory
} from './history'

import { preventXSS } from './render'

import Editor from './lib/editor'

import getUIElements from './lib/editor/ui-elements'
import { emojifyImageDir } from './lib/editor/constants'
import modeType from './lib/modeType'
import appState from './lib/appState'

require('../vendor/showup/showup')

require('../css/index.css')
require('../css/extra.css')
require('../css/slide-preview.css')
require('../css/site.css')
require('spin.js/spin.css')

require('highlight.js/styles/github-gist.css')

var defaultTextHeight = 20
var viewportMargin = 20
var defaultEditorMode = 'gfm'

var idleTime = 300000 // 5 mins
var updateViewDebounce = 100
var cursorMenuThrottle = 50
var cursorActivityDebounce = 50
var cursorAnimatePeriod = 100
var supportContainers = ['success', 'info', 'warning', 'danger', 'spoiler']
var supportCodeModes = ['javascript', 'typescript', 'jsx', 'htmlmixed', 'htmlembedded', 'css', 'xml', 'clike', 'clojure', 'ruby', 'python', 'shell', 'php', 'sql', 'haskell', 'coffeescript', 'yaml', 'pug', 'lua', 'cmake', 'nginx', 'perl', 'sass', 'r', 'dockerfile', 'tiddlywiki', 'mediawiki', 'go', 'gherkin'].concat(hljs.listLanguages())
var supportCharts = ['sequence', 'flow', 'graphviz', 'mermaid', 'abc', 'plantuml', 'vega', 'geo', 'fretboard', 'markmap']
var supportHeaders = [
  {
    text: '# h1',
    search: '#'
  },
  {
    text: '## h2',
    search: '##'
  },
  {
    text: '### h3',
    search: '###'
  },
  {
    text: '#### h4',
    search: '####'
  },
  {
    text: '##### h5',
    search: '#####'
  },
  {
    text: '###### h6',
    search: '######'
  },
  {
    text: '###### tags: `example`',
    search: '###### tags:'
  }
]
const supportReferrals = [
  {
    text: '[reference link]',
    search: '[]'
  },
  {
    text: '[reference]: https:// "title"',
    search: '[]:'
  },
  {
    text: '[^footnote link]',
    search: '[^]'
  },
  {
    text: '[^footnote reference]: https:// "title"',
    search: '[^]:'
  },
  {
    text: '^[inline footnote]',
    search: '^[]'
  },
  {
    text: '[link text][reference]',
    search: '[][]'
  },
  {
    text: '[link text](https:// "title")',
    search: '[]()'
  },
  {
    text: '![image alt][reference]',
    search: '![][]'
  },
  {
    text: '![image alt](https:// "title")',
    search: '![]()'
  },
  {
    text: '![image alt](https:// "title" =WidthxHeight)',
    search: '![]()'
  },
  {
    text: '[TOC]',
    search: '[]'
  }
]
const supportExternals = [
  {
    text: '{%youtube youtubeid %}',
    search: 'youtube'
  },
  {
    text: '{%vimeo vimeoid %}',
    search: 'vimeo'
  },
  {
    text: '{%gist gistid %}',
    search: 'gist'
  },
  {
    text: '{%slideshare slideshareid %}',
    search: 'slideshare'
  },
  {
    text: '{%speakerdeck speakerdeckid %}',
    search: 'speakerdeck'
  },
  {
    text: '{%pdf pdfurl %}',
    search: 'pdf'
  }
]
const supportExtraTags = [
  {
    text: '[name tag]',
    search: '[]',
    command: function () {
      return '[name=' + personalInfo.name + ']'
    }
  },
  {
    text: '[time tag]',
    search: '[]',
    command: function () {
      return '[time=' + moment().format('llll') + ']'
    }
  },
  {
    text: '[my color tag]',
    search: '[]',
    command: function () {
      return '[color=' + personalInfo.color + ']'
    }
  },
  {
    text: '[random color tag]',
    search: '[]',
    command: function () {
      var color = randomColor()
      return '[color=' + color + ']'
    }
  }
]
const statusType = {
  connected: 1,
  online: 2,
  offline: 3
}

// global vars
window.loaded = false
let needRefresh = false
let isDirty = false
let editShown = false
let visibleXS = false
let visibleSM = false
let visibleMD = false
let visibleLG = false
const isTouchDevice = 'ontouchstart' in document.documentElement
let currentStatus = statusType.offline
let isOfflineMode = false
let offlineOperations = []
const lastInfo = {
  needRestore: false,
  cursor: null,
  scroll: null,
  edit: {
    scroll: {
      left: null,
      top: null
    },
    cursor: {
      line: null,
      ch: null
    },
    selections: null
  },
  view: {
    scroll: {
      left: null,
      top: null
    }
  },
  history: null
}
let personalInfo = {}
let onlineUsers = []
const fileTypes = {
  pl: 'perl',
  cgi: 'perl',
  js: 'javascript',
  php: 'php',
  sh: 'bash',
  rb: 'ruby',
  html: 'html',
  py: 'python'
}

// editor settings
const textit = document.getElementById('textit')
if (!textit) {
  throw new Error('There was no textit area!')
}

const editorInstance = new Editor()
var editor = editorInstance.init(textit)

// FIXME: global referncing in jquery-textcomplete patch
window.editor = editor

var inlineAttach = inlineAttachment.editors.codemirror4.attach(editor)
defaultTextHeight = parseInt($('.CodeMirror').css('line-height'))

//  initalize ui reference
const ui = getUIElements()

// page actions
var opts = {
  lines: 11, // The number of lines to draw
  length: 20, // The length of each line
  width: 2, // The line thickness
  radius: 30, // The radius of the inner circle
  corners: 0, // Corner roundness (0..1)
  rotate: 0, // The rotation offset
  direction: 1, // 1: clockwise, -1: counterclockwise
  color: '#000', // #rgb or #rrggbb or array of colors
  speed: 1.1, // Rounds per second
  trail: 60, // Afterglow percentage
  shadow: false, // Whether to render a shadow
  hwaccel: true, // Whether to use hardware acceleration
  className: 'spinner', // The CSS class to assign to the spinner
  zIndex: 2e9, // The z-index (defaults to 2000000000)
  top: '50%', // Top position relative to parent
  left: '50%' // Left position relative to parent
}

new Spinner(opts).spin(ui.spinner[0])

// idle
var idle = new Idle({
  onAway: function () {
    idle.isAway = true
    emitUserStatus()
    updateOnlineStatus()
  },
  onAwayBack: function () {
    idle.isAway = false
    emitUserStatus()
    updateOnlineStatus()
    setHaveUnreadChanges(false)
    updateTitleReminder()
  },
  awayTimeout: idleTime
})
ui.area.codemirror.on('touchstart', function () {
  idle.onActive()
})

var haveUnreadChanges = false

function setHaveUnreadChanges (bool) {
  if (!window.loaded) return
  if (bool && (idle.isAway || Visibility.hidden())) {
    haveUnreadChanges = true
  } else if (!bool && !idle.isAway && !Visibility.hidden()) {
    haveUnreadChanges = false
  }
}

function updateTitleReminder () {
  if (!window.loaded) return
  if (haveUnreadChanges) {
    document.title = '• ' + renderTitle(ui.area.markdown)
  } else {
    document.title = renderTitle(ui.area.markdown)
  }
}

function setRefreshModal (status) {
  $('#refreshModal').modal('show')
  $('#refreshModal').find('.modal-body > div').hide()
  $('#refreshModal').find('.' + status).show()
}

// 新增函数：统一管理离线模式指示器
function updateOfflineIndicator(show) {
  // 移除任何现有的离线指示器
  $('.offline-edit-indicator').remove();
  
  // 如果需要显示，添加新的指示器
  if (show) {
    // 确保不重复添加，先检查是否已存在
    if ($('.offline-edit-indicator').length === 0) {
      const $offlineIndicator = $('<div class="offline-edit-indicator" style="position:fixed; bottom:10px; left:10px; z-index:9999; padding:5px 10px; background-color:rgba(255,165,0,0.8); border-radius:3px; color:#fff;"></div>');
      
      // 单独添加图标和文本，避免HTML字符串中的图标被重复解析
      $offlineIndicator.append($('<i class="fa fa-pencil"></i>'));
      $offlineIndicator.append(document.createTextNode(' 离线编辑模式'));
      
      $('body').append($offlineIndicator);
    }
  }
}

// 新增函数：显示临时通知
function showTemporaryNotification(message, type = 'warning', duration = 3000) {
  // 移除同类型的通知，避免堆积
  $(`.alert-${type}.offline-mode-notification`).remove();
  
  // 创建通知元素
  const $notification = $(`<div class="alert alert-${type} offline-mode-notification" style="position:fixed; top:60px; right:20px; z-index:9999; padding:10px 15px;"></div>`);
  
  // 如果消息包含HTML，使用更安全的方式添加内容
  if (message.indexOf('<') > -1) {
    // 消息包含HTML，拆分图标和文本
    const iconMatch = message.match(/<i class="([^"]+)"><\/i>/);
    if (iconMatch) {
      // 添加图标
      $notification.append($(`<i class="${iconMatch[1]}"></i>`));
      
      // 添加去除图标后的文本
      const textOnly = message.replace(/<i class="[^"]+"><\/i>/, '');
      $notification.append(document.createTextNode(textOnly));
    } else {
      // 没有找到图标模式，直接添加文本
      $notification.text(message);
    }
  } else {
    // 纯文本消息，直接设置
    $notification.text(message);
  }
  
  $('body').append($notification);
  setTimeout(() => $notification.fadeOut(function() { $(this).remove(); }), duration);
}

function setNeedRefresh () {
  needRefresh = true
  
  // 检查是否支持离线模式
  if ('serviceWorker' in navigator) {
    // 不断开socket，而是进入离线编辑模式
    isOfflineMode = true
    showStatus(statusType.offline)
    
    // 显示离线模式提醒
    showTemporaryNotification('<i class="fa fa-exclamation-triangle"></i> 已进入离线编辑模式');
    
    // 更新离线模式指示器
    updateOfflineIndicator(true);
    
    // 保存当前文档到IndexedDB
    const content = editor.getValue();
    const noteId = noteid;
    idbManager.saveNoteSnapshot(noteId, content)
      .then(() => console.log('文档内容已保存到本地存储'))
      .catch(err => console.error('保存文档到本地存储失败:', err));
      
    // 确保编辑器不是只读状态，允许离线编辑
    if (editor.getOption('readOnly')) {
      editor.setOption('readOnly', false);
      console.log('已解除编辑器只读状态');
    }
  } else {
    // 不支持离线模式，采用原有行为
    editor.setOption('readOnly', true)
    socket.disconnect()
    showStatus(statusType.offline)
  }
}

setloginStateChangeEvent(function () {
  setRefreshModal('user-state-changed')
  setNeedRefresh()
})

// visibility
var wasFocus = false
Visibility.change(function (e, state) {
  var hidden = Visibility.hidden()
  if (hidden) {
    if (editorHasFocus()) {
      wasFocus = true
      editor.getInputField().blur()
    }
  } else {
    if (wasFocus) {
      if (!visibleXS) {
        editor.focus()
        editor.refresh()
      }
      wasFocus = false
    }
    setHaveUnreadChanges(false)
  }
  updateTitleReminder()
})

// when page ready
$(document).ready(function () {
  // 检查初始离线状态
  if (!navigator.onLine) {
    console.log('初始状态是离线，启用离线编辑模式');
    isOfflineMode = true;
    
    // 更新UI显示
    updateOfflineIndicator(true);
    
    // 延迟一点确保编辑器已初始化
    setTimeout(function() {
      if (editor.getOption('readOnly')) {
        editor.setOption('readOnly', false);
        console.log('已解除编辑器初始只读状态');
      }
    }, 1000);
  }
  
  // 注册Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/js/sw.js').then(registration => {
        console.log('Service Worker 注册成功:', registration.scope);
      }).catch(error => {
        console.log('Service Worker 注册失败:', error);
      });
    });
    
    // 添加网络状态监听
    window.addEventListener('online', () => {
      if (isOfflineMode) {
        console.log('网络已恢复，尝试重连...');
        socket.connect();
      }
    });
    
    window.addEventListener('offline', () => {
      console.log('网络已断开，进入离线模式');
      // 触发离线模式转换
      if (!isOfflineMode) {
        const noteId = noteid;
        const content = editor.getValue();
        
        // 保存当前状态到IndexedDB
        idbManager.saveEditorState(noteId, content, cmClient ? cmClient.revision : -1, lastInfo)
          .then(() => {
            console.log('文档状态已保存到本地存储');
            isOfflineMode = true;
            
            // 显示离线模式提醒
            showTemporaryNotification('<i class="fa fa-exclamation-triangle"></i> 网络断开，已进入离线编辑模式', 'warning');
          })
          .catch(err => console.error('保存文档到本地存储失败:', err));
      }
    });
    
    // 检查初始网络状态
    if (!navigator.onLine) {
      console.log('初始状态: 离线');
      // 设置为离线模式，但不显示通知
      isOfflineMode = true;
    }
  }
  
  idle.checkAway()
  checkResponsive()
  // if in smaller screen, we don't need advanced scrollbar
  var scrollbarStyle
  if (visibleXS) {
    scrollbarStyle = 'native'
  } else {
    scrollbarStyle = 'overlay'
  }
  if (scrollbarStyle !== editor.getOption('scrollbarStyle')) {
    editor.setOption('scrollbarStyle', scrollbarStyle)
    clearMap()
  }
  checkEditorStyle()

  /* cache dom references */
  var $body = $('body')

  /* we need this only on touch devices */
  if (isTouchDevice) {
    /* bind events */
    $(document)
      .on('focus', 'textarea, input', function () {
        $body.addClass('fixfixed')
      })
      .on('blur', 'textarea, input', function () {
        $body.removeClass('fixfixed')
      })
  }

  // Re-enable nightmode
  if (store.get('nightMode') || Cookies.get('nightMode')) {
    $body.addClass('night')
    ui.toolbar.night.addClass('active')
  }

  // showup
  $().showUp('.navbar', {
    upClass: 'navbar-hide',
    downClass: 'navbar-show'
  })
  // tooltip
  $('[data-toggle="tooltip"]').tooltip()
  // shortcuts
  // allow on all tags
  key.filter = function (e) { return true }
  key('ctrl+alt+e', function (e) {
    changeMode(modeType.edit)
  })
  key('ctrl+alt+v', function (e) {
    changeMode(modeType.view)
  })
  key('ctrl+alt+b', function (e) {
    changeMode(modeType.both)
  })
  // toggle-dropdown
  $(document).on('click', '.toggle-dropdown .dropdown-menu', function (e) {
    e.stopPropagation()
  })

  // 初始化离线编辑状态UI
  if (isOfflineMode) {
    // 使用统一的函数添加离线指示器
    updateOfflineIndicator(true);
  }
  
  // 注册Service Worker
  if ('serviceWorker' in navigator) {
    // ... 现有代码

    // 向Service Worker发送缓存笔记请求
    function cacheCurrentNote() {
      if (navigator.serviceWorker.controller) {
        const content = editor.getValue();
        navigator.serviceWorker.controller.postMessage({
          type: 'CACHE_NOTE',
          noteId: noteid,
          content: content
        });
      }
    }
    
    // 定期缓存当前笔记
    if (isOfflineMode) {
      // 立即缓存
      setTimeout(cacheCurrentNote, 2000);
      
      // 定期缓存
      setInterval(cacheCurrentNote, 60000);
    }
    
    // 监听Service Worker消息
    navigator.serviceWorker.addEventListener('message', function(event) {
      if (event.data && event.data.type === 'TRY_SYNC_OPERATIONS') {
        if (isOfflineMode) {
          console.log('收到同步请求，但当前处于离线模式');
        } else if (event.data.noteId === noteid) {
          console.log('收到同步请求，尝试同步');
          syncOfflineChanges().catch(err => {
            console.error('同步失败:', err);
          });
        }
      } else if (event.data && event.data.type === 'NOTE_CACHED') {
        console.log('笔记已缓存:', event.data.noteId);
      }
    });
  }
  
  // ... 现有代码
})
// when page resize
$(window).resize(function () {
  checkLayout()
  checkEditorStyle()
  checkTocStyle()
  checkCursorMenu()
  windowResize()
})
// when page unload
$(window).on('unload', function () {
// updateHistoryInner();
})
$(window).on('error', function () {
  // setNeedRefresh();
})

setupSyncAreas(ui.area.codemirrorScroll, ui.area.view, ui.area.markdown, editor)

function autoSyncscroll () {
  if (editorHasFocus()) {
    syncScrollToView()
  } else {
    syncScrollToEdit()
  }
}

var windowResizeDebounce = 200
var windowResize = _.debounce(windowResizeInner, windowResizeDebounce)

function windowResizeInner (callback) {
  checkLayout()
  checkResponsive()
  checkEditorStyle()
  checkTocStyle()
  checkCursorMenu()
  // refresh editor
  if (window.loaded) {
    if (editor.getOption('scrollbarStyle') === 'native') {
      setTimeout(function () {
        clearMap()
        autoSyncscroll()
        updateScrollspy()
        if (callback && typeof callback === 'function') { callback() }
      }, 1)
    } else {
      // force it load all docs at once to prevent scroll knob blink
      editor.setOption('viewportMargin', Infinity)
      setTimeout(function () {
        clearMap()
        autoSyncscroll()
        editor.setOption('viewportMargin', viewportMargin)
        // add or update user cursors
        for (var i = 0; i < onlineUsers.length; i++) {
          if (onlineUsers[i].id !== personalInfo.id) { buildCursor(onlineUsers[i]) }
        }
        updateScrollspy()
        if (callback && typeof callback === 'function') { callback() }
      }, 1)
    }
  }
}

function checkLayout () {
  var navbarHieght = $('.navbar').outerHeight()
  $('body').css('padding-top', navbarHieght + 'px')
}

function editorHasFocus () {
  return $(editor.getInputField()).is(':focus')
}

// 768-792px have a gap
function checkResponsive () {
  visibleXS = $('.visible-xs').is(':visible')
  visibleSM = $('.visible-sm').is(':visible')
  visibleMD = $('.visible-md').is(':visible')
  visibleLG = $('.visible-lg').is(':visible')

  if (visibleXS && appState.currentMode === modeType.both) {
    if (editorHasFocus()) { changeMode(modeType.edit) } else { changeMode(modeType.view) }
  }

  emitUserStatus()
}

var lastEditorWidth = 0
var previousFocusOnEditor = null

function checkEditorStyle () {
  var desireHeight = editorInstance.statusBar ? (ui.area.edit.height() - editorInstance.statusBar.outerHeight()) : ui.area.edit.height()
  if (editorInstance.toolBar) {
    desireHeight = desireHeight - editorInstance.toolBar.outerHeight()
  }
  // set editor height and min height based on scrollbar style and mode
  var scrollbarStyle = editor.getOption('scrollbarStyle')
  if (scrollbarStyle === 'overlay' || appState.currentMode === modeType.both) {
    ui.area.codemirrorScroll.css('height', desireHeight + 'px')
    ui.area.codemirrorScroll.css('min-height', '')
    checkEditorScrollbar()
  } else if (scrollbarStyle === 'native') {
    ui.area.codemirrorScroll.css('height', '')
    ui.area.codemirrorScroll.css('min-height', desireHeight + 'px')
  }
  // workaround editor will have wrong doc height when editor height changed
  editor.setSize(null, ui.area.edit.height())
  checkEditorScrollOverLines()
  // make editor resizable
  if (!ui.area.resize.handle.length) {
    ui.area.edit.resizable({
      handles: 'e',
      maxWidth: $(window).width() * 0.7,
      minWidth: $(window).width() * 0.2,
      create: function (e, ui) {
        $(this).parent().on('resize', function (e) {
          e.stopPropagation()
        })
      },
      start: function (e) {
        editor.setOption('viewportMargin', Infinity)
      },
      resize: function (e) {
        ui.area.resize.syncToggle.stop(true, true).show()
        checkTocStyle()
      },
      stop: function (e) {
        lastEditorWidth = ui.area.edit.width()
        // workaround that scroll event bindings
        window.preventSyncScrollToView = 2
        window.preventSyncScrollToEdit = true
        editor.setOption('viewportMargin', viewportMargin)
        if (editorHasFocus()) {
          windowResizeInner(function () {
            ui.area.codemirrorScroll.scroll()
          })
        } else {
          windowResizeInner(function () {
            ui.area.view.scroll()
          })
        }
        checkEditorScrollbar()
      }
    })
    ui.area.resize.handle = $('.ui-resizable-handle')
  }
  if (!ui.area.resize.syncToggle.length) {
    ui.area.resize.syncToggle = $('<button class="btn btn-lg btn-default ui-sync-toggle" title="Toggle sync scrolling"><i class="fa fa-link fa-fw"></i></button>')
    ui.area.resize.syncToggle.hover(function () {
      previousFocusOnEditor = editorHasFocus()
    }, function () {
      previousFocusOnEditor = null
    })
    ui.area.resize.syncToggle.click(function () {
      appState.syncscroll = !appState.syncscroll
      checkSyncToggle()
    })
    ui.area.resize.handle.append(ui.area.resize.syncToggle)
    ui.area.resize.syncToggle.hide()
    ui.area.resize.handle.hover(function () {
      ui.area.resize.syncToggle.stop(true, true).delay(200).fadeIn(100)
    }, function () {
      ui.area.resize.syncToggle.stop(true, true).delay(300).fadeOut(300)
    })
  }
}

function checkSyncToggle () {
  if (appState.syncscroll) {
    if (previousFocusOnEditor) {
      window.preventSyncScrollToView = false
      syncScrollToView()
    } else {
      window.preventSyncScrollToEdit = false
      syncScrollToEdit()
    }
    ui.area.resize.syncToggle.find('i').removeClass('fa-unlink').addClass('fa-link')
  } else {
    ui.area.resize.syncToggle.find('i').removeClass('fa-link').addClass('fa-unlink')
  }
}

var checkEditorScrollbar = _.debounce(function () {
  editor.operation(checkEditorScrollbarInner)
}, 50)

function checkEditorScrollbarInner () {
  // workaround simple scroll bar knob
  // will get wrong position when editor height changed
  var scrollInfo = editor.getScrollInfo()
  editor.scrollTo(null, scrollInfo.top - 1)
  editor.scrollTo(null, scrollInfo.top)
}

function checkEditorScrollOverLines () {
  const desireHeight = parseInt(ui.area.codemirrorScroll[0].style.height) || parseInt(ui.area.codemirrorScroll[0].style.minHeight)
  // make editor have extra padding in the bottom (except small screen)
  const paddingBottom = editor.doc && editor.doc.height > defaultTextHeight ? (desireHeight - defaultTextHeight) : 0
  if (parseInt(ui.area.codemirrorLines.css('padding-bottom')) !== paddingBottom) {
    ui.area.codemirrorLines.css('padding-bottom', paddingBottom + 'px')
  }
}

function checkTocStyle () {
  // toc right
  var paddingRight = parseFloat(ui.area.markdown.css('padding-right'))
  var right = ($(window).width() - (ui.area.markdown.offset().left + ui.area.markdown.outerWidth() - paddingRight))
  ui.toc.toc.css('right', right + 'px')
  // affix toc left
  var newbool
  var rightMargin = (ui.area.markdown.parent().outerWidth() - ui.area.markdown.outerWidth()) / 2
  // for ipad or wider device
  if (rightMargin >= 133) {
    newbool = true
    var affixLeftMargin = (ui.toc.affix.outerWidth() - ui.toc.affix.width()) / 2
    var left = ui.area.markdown.offset().left + ui.area.markdown.outerWidth() - affixLeftMargin
    ui.toc.affix.css('left', left + 'px')
    ui.toc.affix.css('width', rightMargin + 'px')
  } else {
    newbool = false
  }
  // toc scrollspy
  ui.toc.toc.removeClass('scrollspy-body, scrollspy-view')
  ui.toc.affix.removeClass('scrollspy-body, scrollspy-view')
  if (appState.currentMode === modeType.both) {
    ui.toc.toc.addClass('scrollspy-view')
    ui.toc.affix.addClass('scrollspy-view')
  } else if (appState.currentMode !== modeType.both && !newbool) {
    ui.toc.toc.addClass('scrollspy-body')
    ui.toc.affix.addClass('scrollspy-body')
  } else {
    ui.toc.toc.addClass('scrollspy-view')
    ui.toc.affix.addClass('scrollspy-body')
  }
  if (newbool !== enoughForAffixToc) {
    enoughForAffixToc = newbool
    generateScrollspy()
  }
}

function showStatus (type, num) {
  currentStatus = type

  ui.toolbar.statusConnected.hide()
  ui.toolbar.statusOnline.hide()
  ui.toolbar.statusOffline.hide()

  switch (currentStatus) {
    case statusType.connected:
      ui.toolbar.statusConnected.show()
      break
    case statusType.online:
      ui.toolbar.statusShortMsg.text(num)
      ui.toolbar.statusOnline.show()
      // 确保在切换到在线状态时移除离线编辑指示器
      updateOfflineIndicator(false)
      break
    case statusType.offline:
      // // 完全重新构建离线状态显示，避免图标重复
      // const $statusOffline = ui.toolbar.statusOffline
      
      // // 使用text()方法设置文本，而不是html()或append()，防止生成多余图标
      // // 首先清空内容，确保没有残留的元素
      // $statusOffline.empty()
      
      // // 添加单个图标
      // $statusOffline.append($('<i class="fa fa-plug"></i>'))
      
      // // 添加适当的文本作为纯文本（避免使用append追加文本，这可能导致问题）
      // if (isOfflineMode) {
      //   $statusOffline.append(document.createTextNode(' 离线编辑模式'))
      // } else {
      //   $statusOffline.append(document.createTextNode(' ' + __('OFFLINE')))
      // }
      
      // // 显示状态
      // $statusOffline.show()
      ui.toolbar.statusOffline.show()
      break
  }
}

function toggleMode () {
  switch (appState.currentMode) {
    case modeType.edit:
      changeMode(modeType.view)
      break
    case modeType.view:
      changeMode(modeType.edit)
      break
    case modeType.both:
      changeMode(modeType.view)
      break
  }
}

var lastMode = null

function changeMode (type) {
  // lock navbar to prevent it hide after changeMode
  lockNavbar()
  saveInfo()
  if (type) {
    lastMode = appState.currentMode
    appState.currentMode = type
  }
  var responsiveClass = 'col-lg-6 col-md-6 col-sm-6'
  var scrollClass = 'ui-scrollable'
  ui.area.codemirror.removeClass(scrollClass)
  ui.area.edit.removeClass(responsiveClass)
  ui.area.view.removeClass(scrollClass)
  ui.area.view.removeClass(responsiveClass)
  switch (appState.currentMode) {
    case modeType.edit:
      ui.area.edit.show()
      ui.area.view.hide()
      if (!editShown) {
        editor.refresh()
        editShown = true
      }
      break
    case modeType.view:
      ui.area.edit.hide()
      ui.area.view.show()
      break
    case modeType.both:
      ui.area.codemirror.addClass(scrollClass)
      ui.area.edit.addClass(responsiveClass).show()
      ui.area.view.addClass(scrollClass)
      ui.area.view.show()
      break
  }
  // save mode to url
  if (history.replaceState && window.loaded) history.replaceState(null, '', serverurl + '/' + noteid + '?' + appState.currentMode.name)
  if (appState.currentMode === modeType.view) {
    editor.getInputField().blur()
  }
  if (appState.currentMode === modeType.edit || appState.currentMode === modeType.both) {
    ui.toolbar.uploadImage.fadeIn()
    // add and update status bar
    if (!editorInstance.statusBar) {
      editorInstance.addStatusBar()
      editorInstance.updateStatusBar()
    }
    // add and update tool bar
    if (!editorInstance.toolBar) {
      editorInstance.addToolBar()
    }
    // work around foldGutter might not init properly
    editor.setOption('foldGutter', false)
    editor.setOption('foldGutter', true)
  } else {
    ui.toolbar.uploadImage.fadeOut()
  }
  if (appState.currentMode !== modeType.edit) {
    $(document.body).css('background-color', 'white')
    updateView()
  } else {
    $(document.body).css('background-color', ui.area.codemirror.css('background-color'))
  }
  // check resizable editor style
  if (appState.currentMode === modeType.both) {
    if (lastEditorWidth > 0) {
      ui.area.edit.css('width', lastEditorWidth + 'px')
    } else {
      ui.area.edit.css('width', '')
    }
    ui.area.resize.handle.show()
  } else {
    ui.area.edit.css('width', '')
    ui.area.resize.handle.hide()
  }

  windowResizeInner()

  restoreInfo()

  if (lastMode === modeType.view && appState.currentMode === modeType.both) {
    window.preventSyncScrollToView = 2
    syncScrollToEdit(null, true)
  }

  if (lastMode === modeType.edit && appState.currentMode === modeType.both) {
    window.preventSyncScrollToEdit = 2
    syncScrollToView(null, true)
  }

  if (lastMode === modeType.both && appState.currentMode !== modeType.both) {
    window.preventSyncScrollToView = false
    window.preventSyncScrollToEdit = false
  }

  if (lastMode !== modeType.edit && appState.currentMode === modeType.edit) {
    editor.refresh()
  }

  $(document.body).scrollspy('refresh')
  ui.area.view.scrollspy('refresh')

  ui.toolbar.both.removeClass('active')
  ui.toolbar.edit.removeClass('active')
  ui.toolbar.view.removeClass('active')
  var modeIcon = ui.toolbar.mode.find('i')
  modeIcon.removeClass('fa-pencil').removeClass('fa-eye')
  if (ui.area.edit.is(':visible') && ui.area.view.is(':visible')) { // both
    ui.toolbar.both.addClass('active')
    modeIcon.addClass('fa-eye')
  } else if (ui.area.edit.is(':visible')) { // edit
    ui.toolbar.edit.addClass('active')
    modeIcon.addClass('fa-eye')
  } else if (ui.area.view.is(':visible')) { // view
    ui.toolbar.view.addClass('active')
    modeIcon.addClass('fa-pencil')
  }
  unlockNavbar()
}

function lockNavbar () {
  $('.navbar').addClass('locked')
}

var unlockNavbar = _.debounce(function () {
  $('.navbar').removeClass('locked')
}, 200)

function showMessageModal (title, header, href, text, success) {
  var modal = $('.message-modal')
  modal.find('.modal-title').html(title)
  modal.find('.modal-body h5').html(header)
  if (href) { modal.find('.modal-body a').attr('href', href).text(text) } else { modal.find('.modal-body a').removeAttr('href').text(text) }
  modal.find('.modal-footer button').removeClass('btn-default btn-success btn-danger')
  if (success) { modal.find('.modal-footer button').addClass('btn-success') } else { modal.find('.modal-footer button').addClass('btn-danger') }
  modal.modal('show')
}

// check if dropbox app key is set and load scripts
if (DROPBOX_APP_KEY) {
  $('<script>')
    .attr('type', 'text/javascript')
    .attr('src', 'https://www.dropbox.com/static/api/2/dropins.js')
    .attr('id', 'dropboxjs')
    .attr('data-app-key', DROPBOX_APP_KEY)
    .prop('async', true)
    .prop('defer', true)
    .appendTo('body')
} else {
  ui.toolbar.import.dropbox.hide()
  ui.toolbar.export.dropbox.hide()
}

// button actions
// share
ui.toolbar.publish.attr('href', noteurl + '/publish')
// extra
// slide
ui.toolbar.extra.slide.attr('href', noteurl + '/slide')
// download
// markdown
ui.toolbar.download.markdown.click(function (e) {
  e.preventDefault()
  e.stopPropagation()
  var filename = renderFilename(ui.area.markdown) + '.md'
  var markdown = editor.getValue()
  var blob = new Blob([markdown], {
    type: 'text/markdown;charset=utf-8'
  })
  saveAs(blob, filename, true)
})
// html
ui.toolbar.download.html.click(function (e) {
  e.preventDefault()
  e.stopPropagation()
  exportToHTML(ui.area.markdown)
})
// raw html
ui.toolbar.download.rawhtml.click(function (e) {
  e.preventDefault()
  e.stopPropagation()
  exportToRawHTML(ui.area.markdown)
})
// pdf
ui.toolbar.download.pdf.attr('download', '').attr('href', noteurl + '/pdf')

ui.modal.pandocExport.find('#pandoc-export-download').click(function (e) {
  e.preventDefault()

  const exportType = ui.modal.pandocExport.find('select[name="output"]').val()

  window.open(`${noteurl}/pandoc?exportType=${exportType}`, '_blank')
})

// export to dropbox
ui.toolbar.export.dropbox.click(function () {
  var filename = renderFilename(ui.area.markdown) + '.md'
  var options = {
    files: [
      {
        url: noteurl + '/download',
        filename: filename
      }
    ],
    error: function (errorMessage) {
      console.error(errorMessage)
    }
  }
  Dropbox.save(options)
})
// export to gist
ui.toolbar.export.gist.attr('href', noteurl + '/gist')
// export to snippet
ui.toolbar.export.snippet.click(function () {
  ui.spinner.show()
  $.get(serverurl + '/auth/gitlab/callback/' + noteid + '/projects')
    .done(function (data) {
      $('#snippetExportModalAccessToken').val(data.accesstoken)
      $('#snippetExportModalBaseURL').val(data.baseURL)
      $('#snippetExportModalVersion').val(data.version)
      $('#snippetExportModalLoading').hide()
      $('#snippetExportModal').modal('toggle')
      $('#snippetExportModalProjects').find('option').remove().end().append('<option value="init" selected="selected" disabled="disabled">Select From Available Projects</option>')
      if (data.projects) {
        data.projects.sort(function (a, b) {
          return (a.path_with_namespace < b.path_with_namespace) ? -1 : ((a.path_with_namespace > b.path_with_namespace) ? 1 : 0)
        })
        data.projects.forEach(function (project) {
          if (!project.snippets_enabled ||
                        (project.permissions.project_access === null && project.permissions.group_access === null) ||
                        (project.permissions.project_access !== null && project.permissions.project_access.access_level < 20)) {
            return
          }
          $('<option>').val(project.id).text(project.path_with_namespace).appendTo('#snippetExportModalProjects')
        })
        $('#snippetExportModalProjects').prop('disabled', false)
      }
      $('#snippetExportModalLoading').hide()
    })
    .fail(function (data) {
      showMessageModal('<i class="fa fa-gitlab"></i> Import from Snippet', 'Unable to fetch gitlab parameters :(', '', '', false)
    })
    .always(function () {
      ui.spinner.hide()
    })
})
// import from dropbox
ui.toolbar.import.dropbox.click(function () {
  var options = {
    success: function (files) {
      ui.spinner.show()
      var url = files[0].link
      importFromUrl(url)
    },
    linkType: 'direct',
    multiselect: false,
    extensions: ['.md', '.html']
  }
  Dropbox.choose(options)
})
// import from gist
ui.toolbar.import.gist.click(function () {
  // na
})
// import from snippet
ui.toolbar.import.snippet.click(function () {
  ui.spinner.show()
  $.get(serverurl + '/auth/gitlab/callback/' + noteid + '/projects')
    .done(function (data) {
      $('#snippetImportModalAccessToken').val(data.accesstoken)
      $('#snippetImportModalBaseURL').val(data.baseURL)
      $('#snippetImportModalVersion').val(data.version)
      $('#snippetImportModalContent').prop('disabled', false)
      $('#snippetImportModalConfirm').prop('disabled', false)
      $('#snippetImportModalLoading').hide()
      $('#snippetImportModal').modal('toggle')
      $('#snippetImportModalProjects').find('option').remove().end().append('<option value="init" selected="selected" disabled="disabled">Select From Available Projects</option>')
      if (data.projects) {
        data.projects.sort(function (a, b) {
          return (a.path_with_namespace < b.path_with_namespace) ? -1 : ((a.path_with_namespace > b.path_with_namespace) ? 1 : 0)
        })
        data.projects.forEach(function (project) {
          if (!project.snippets_enabled ||
                        (project.permissions.project_access === null && project.permissions.group_access === null) ||
                        (project.permissions.project_access !== null && project.permissions.project_access.access_level < 20)) {
            return
          }
          $('<option>').val(project.id).text(project.path_with_namespace).appendTo('#snippetImportModalProjects')
        })
        $('#snippetImportModalProjects').prop('disabled', false)
      }
      $('#snippetImportModalLoading').hide()
    })
    .fail(function (data) {
      showMessageModal('<i class="fa fa-gitlab"></i> Import from Snippet', 'Unable to fetch gitlab parameters :(', '', '', false)
    })
    .always(function () {
      ui.spinner.hide()
    })
})
// import from clipboard
ui.toolbar.import.clipboard.click(function () {
  // na
})
// upload image
ui.toolbar.uploadImage.bind('change', function (e) {
  var files = e.target.files || e.dataTransfer.files
  e.dataTransfer = {}
  e.dataTransfer.files = files
  inlineAttach.onDrop(e)
})
// toc
ui.toc.dropdown.click(function (e) {
  e.stopPropagation()
})
// prevent empty link change hash
$('a[href="#"]').click(function (e) {
  e.preventDefault()
})

// modal actions
var revisions = []
var revisionViewer = null
var revisionInsert = []
var revisionDelete = []
var revisionInsertAnnotation = null
var revisionDeleteAnnotation = null
var revisionList = ui.modal.revision.find('.ui-revision-list')
var revision = null
var revisionTime = null
ui.modal.revision.on('show.bs.modal', function (e) {
  $.get(noteurl + '/revision')
    .done(function (data) {
      parseRevisions(data.revision)
      initRevisionViewer()
    })
    .fail(function (err) {
      if (debug) {
        console.log(err)
      }
    })
    .always(function () {
      // na
    })
})
function checkRevisionViewer () {
  if (revisionViewer) {
    var container = $(revisionViewer.display.wrapper).parent()
    $(revisionViewer.display.scroller).css('height', container.height() + 'px')
    revisionViewer.refresh()
  }
}
ui.modal.revision.on('shown.bs.modal', checkRevisionViewer)
$(window).resize(checkRevisionViewer)
function parseRevisions (_revisions) {
  console.log('parseRevisions called with:', _revisions);
  
  // 确保_revisions是有效的数组
  if (!Array.isArray(_revisions)) {
    console.warn('Received invalid revisions data:', _revisions);
    _revisions = [];
  }

  // 强制更新修订版本列表，无论内容是否变化
  revisions = _revisions;
  console.log('Revision count:', revisions.length);
  
  var lastRevision = null;
  if (revisionList.children().length > 0) {
    lastRevision = revisionList.find('.active').attr('data-revision-time');
    console.log('Last active revision:', lastRevision);
  }
  
  // 清空列表
  revisionList.html('');
  
  // 如果没有修订版本，显示提示
  if (revisions.length === 0) {
    console.log('No revisions found, showing empty state');
    revisionList.html('<div class="text-center text-muted" style="padding: 20px;">暂无修订版本</div>');
    return;
  }
  
  // 创建修订版本列表
  console.log('Creating revision list items');
  for (var i = 0; i < revisions.length; i++) {
    var revision = revisions[i];
    var item = $('<a href="#" class="list-group-item"></a>');
    item.attr('data-revision-time', revision.time);
    if (lastRevision === revision.time.toString()) item.addClass('active');
    var itemHeading = $('<h5 class="list-group-item-heading"></h5>');
    itemHeading.html('<i class="fa fa-clock-o"></i> ' + moment(revision.time).format('llll'));
    var itemText = $('<p class="list-group-item-text"></p>');
    itemText.html('<i class="fa fa-file-text"></i> Length: ' + revision.length);
    item.append(itemHeading).append(itemText);
    item.click(function (e) {
      e.preventDefault();
      var time = $(this).attr('data-revision-time');
      selectRevision(time);
    });
    revisionList.append(item);
  }
  
  // 如果没有活动的修订版本但列表不为空，选择第一个
  if ((!lastRevision || revisionList.find('.active').length === 0) && revisions.length > 0) {
    console.log('No active revision, selecting first one');
    selectRevision(revisions[0].time);
  }
}
function selectRevision (time) {
  console.log('Selecting revision with time:', time);
  if (time === revisionTime) {
    console.log('Already selected this revision, skipping');
    return;
  }
  
  $.get(noteurl + '/revision/' + time)
    .done(function (data) {
      console.log('Revision data loaded successfully');
      revision = data;
      revisionTime = time;
      
      // 保存当前滚动位置
      var lastScrollInfo = revisionViewer ? revisionViewer.getScrollInfo() : null;
      
      // 清除所有修订版本项的激活状态
      revisionList.children().removeClass('active');
      
      // 设置当前选中项的激活状态
      var selectedItem = revisionList.find('[data-revision-time="' + time + '"]');
      selectedItem.addClass('active');
      
      console.log('Setting content to revision viewer');
      var content = revision.content;
      
      // 确保revisionViewer已初始化
      if (!revisionViewer) {
        console.log('Initializing revision viewer');
        initRevisionViewer();
      }
      
      // 设置内容到查看器
      revisionViewer.setValue(content || '');
      
      // 恢复滚动位置
      if (lastScrollInfo) {
        revisionViewer.scrollTo(null, lastScrollInfo.top);
      }
      
      // 清除之前的标记
      revisionInsert = [];
      revisionDelete = [];
      
      // 标记文本差异
      if (revision.patch && revision.patch.length > 0) {
        console.log('Marking revision differences');
        var bias = 0;
        for (var j = 0; j < revision.patch.length; j++) {
          var patch = revision.patch[j];
          var currIndex = patch.start1 + bias;
          for (var i = 0; i < patch.diffs.length; i++) {
            var diff = patch.diffs[i];
            // 忽略仅包含换行符的差异
            if ((diff[1].match(/\n/g) || []).length === diff[1].length) continue;
            var prePos;
            var postPos;
            
            try {
              switch (diff[0]) {
                case 0: // 保持
                  currIndex += diff[1].length;
                  break;
                case 1: // 插入
                  prePos = revisionViewer.posFromIndex(currIndex);
                  postPos = revisionViewer.posFromIndex(currIndex + diff[1].length);
                  revisionInsert.push({
                    from: prePos,
                    to: postPos
                  });
                  revisionViewer.markText(prePos, postPos, {
                    css: 'background-color: rgba(230,255,230,0.7); text-decoration: underline;'
                  });
                  currIndex += diff[1].length;
                  break;
                case -1: // 删除
                  prePos = revisionViewer.posFromIndex(currIndex);
                  revisionViewer.replaceRange(diff[1], prePos);
                  postPos = revisionViewer.posFromIndex(currIndex + diff[1].length);
                  revisionDelete.push({
                    from: prePos,
                    to: postPos
                  });
                  revisionViewer.markText(prePos, postPos, {
                    css: 'background-color: rgba(255,230,230,0.7); text-decoration: line-through;'
                  });
                  bias += diff[1].length;
                  currIndex += diff[1].length;
                  break;
              }
            } catch (err) {
              console.error('Error marking diff:', err);
            }
          }
        }
      }
      
      // 更新滚动条注释
      if (revisionInsertAnnotation) revisionInsertAnnotation.update(revisionInsert);
      if (revisionDeleteAnnotation) revisionDeleteAnnotation.update(revisionDelete);
      
      console.log('Revision selected and displayed successfully');
    })
    .fail(function (xhr, status, err) {
      console.error('Failed to load revision:', status, err);
      showMessageModal(
        '<i class="fa fa-history"></i> 修订版本',
        '加载修订版本失败',
        null,
        '无法加载所选修订版本，请重试',
        false
      );
    });
}
function initRevisionViewer () {
  if (revisionViewer) return
  var revisionViewerTextArea = document.getElementById('revisionViewer')
  revisionViewer = CodeMirror.fromTextArea(revisionViewerTextArea, {
    mode: defaultEditorMode,
    viewportMargin: viewportMargin,
    lineNumbers: true,
    lineWrapping: true,
    showCursorWhenSelecting: true,
    inputStyle: 'textarea',
    gutters: ['CodeMirror-linenumbers'],
    flattenSpans: true,
    addModeClass: true,
    readOnly: true,
    autoRefresh: true,
    scrollbarStyle: 'overlay'
  })
  revisionInsertAnnotation = revisionViewer.annotateScrollbar({ className: 'CodeMirror-insert-match' })
  revisionDeleteAnnotation = revisionViewer.annotateScrollbar({ className: 'CodeMirror-delete-match' })
  checkRevisionViewer()
}
$('#revisionModalDownload').click(function () {
  if (!revision) return
  var filename = renderFilename(ui.area.markdown) + '_' + revisionTime + '.md'
  var blob = new Blob([revision.content], {
    type: 'text/markdown;charset=utf-8'
  })
  saveAs(blob, filename, true)
})
$('#revisionModalRevert').click(function () {
  if (!revision) return
  editor.setValue(revision.content)
  ui.modal.revision.modal('hide')
})
// snippet projects
ui.modal.snippetImportProjects.change(function () {
  var accesstoken = $('#snippetImportModalAccessToken').val()
  var baseURL = $('#snippetImportModalBaseURL').val()
  var project = $('#snippetImportModalProjects').val()
  var version = $('#snippetImportModalVersion').val()
  $('#snippetImportModalLoading').show()
  $('#snippetImportModalContent').val('/projects/' + project)
  $.get(baseURL + '/api/' + version + '/projects/' + project + '/snippets?access_token=' + accesstoken)
    .done(function (data) {
      $('#snippetImportModalSnippets').find('option').remove().end().append('<option value="init" selected="selected" disabled="disabled">Select From Available Snippets</option>')
      data.forEach(function (snippet) {
        $('<option>').val(snippet.id).text(snippet.title).appendTo($('#snippetImportModalSnippets'))
      })
      $('#snippetImportModalLoading').hide()
      $('#snippetImportModalSnippets').prop('disabled', false)
    })
    .fail(function (err) {
      if (debug) {
        console.log(err)
      }
    })
    .always(function () {
      // na
    })
})
// snippet snippets
ui.modal.snippetImportSnippets.change(function () {
  var snippet = $('#snippetImportModalSnippets').val()
  $('#snippetImportModalContent').val($('#snippetImportModalContent').val() + '/snippets/' + snippet)
})

function scrollToTop () {
  if (appState.currentMode === modeType.both) {
    if (editor.getScrollInfo().top !== 0) { editor.scrollTo(0, 0) } else {
      ui.area.view.animate({
        scrollTop: 0
      }, 100, 'linear')
    }
  } else {
    $('body, html').stop(true, true).animate({
      scrollTop: 0
    }, 100, 'linear')
  }
}

function scrollToBottom () {
  if (appState.currentMode === modeType.both) {
    var scrollInfo = editor.getScrollInfo()
    var scrollHeight = scrollInfo.height
    if (scrollInfo.top !== scrollHeight) { editor.scrollTo(0, scrollHeight * 2) } else {
      ui.area.view.animate({
        scrollTop: ui.area.view[0].scrollHeight
      }, 100, 'linear')
    }
  } else {
    $('body, html').stop(true, true).animate({
      scrollTop: $(document.body)[0].scrollHeight
    }, 100, 'linear')
  }
}

window.scrollToTop = scrollToTop
window.scrollToBottom = scrollToBottom

var enoughForAffixToc = true

// scrollspy
function generateScrollspy () {
  $(document.body).scrollspy({
    target: '.scrollspy-body'
  })
  ui.area.view.scrollspy({
    target: '.scrollspy-view'
  })
  $(document.body).scrollspy('refresh')
  ui.area.view.scrollspy('refresh')
  if (enoughForAffixToc) {
    ui.toc.toc.hide()
    ui.toc.affix.show()
  } else {
    ui.toc.affix.hide()
    ui.toc.toc.show()
  }
  // $(document.body).scroll();
  // ui.area.view.scroll();
}

function updateScrollspy () {
  var headers = ui.area.markdown.find('h1, h2, h3').toArray()
  var headerMap = []
  for (var i = 0; i < headers.length; i++) {
    headerMap.push($(headers[i]).offset().top - parseInt($(headers[i]).css('margin-top')))
  }
  applyScrollspyActive($(window).scrollTop(), headerMap, headers,
    $('.scrollspy-body'), 0)
  var offset = ui.area.view.scrollTop() - ui.area.view.offset().top
  applyScrollspyActive(ui.area.view.scrollTop(), headerMap, headers,
    $('.scrollspy-view'), offset - 10)
}

function applyScrollspyActive (top, headerMap, headers, target, offset) {
  var index = 0
  for (var i = headerMap.length - 1; i >= 0; i--) {
    if (top >= (headerMap[i] + offset) && headerMap[i + 1] && top < (headerMap[i + 1] + offset)) {
      index = i
      break
    }
  }
  var header = $(headers[index])
  var active = target.find('a[href="#' + header.attr('id') + '"]')
  active.closest('li').addClass('active').parent().closest('li').addClass('active').parent().closest('li').addClass('active')
}

// clipboard modal
// fix for wrong autofocus
$('#clipboardModal').on('shown.bs.modal', function () {
  $('#clipboardModal').blur()
})
$('#clipboardModalClear').click(function () {
  $('#clipboardModalContent').html('')
})
$('#clipboardModalConfirm').click(function () {
  var data = $('#clipboardModalContent').html()
  if (data) {
    parseToEditor(data)
    $('#clipboardModal').modal('hide')
    $('#clipboardModalContent').html('')
  }
})

// refresh modal
$('#refreshModalRefresh').click(function () {
  location.reload(true)
})

// gist import modal
$('#gistImportModalClear').click(function () {
  $('#gistImportModalContent').val('')
})
$('#gistImportModalConfirm').click(function () {
  var gisturl = $('#gistImportModalContent').val()
  if (!gisturl) return
  $('#gistImportModal').modal('hide')
  $('#gistImportModalContent').val('')
  if (!isURL(gisturl)) {
    showMessageModal('<i class="fa fa-github"></i> Import from Gist', 'Not a valid URL :(', '', '', false)
  } else {
    var hostname = wurl('hostname', gisturl)
    if (hostname !== 'gist.github.com') {
      showMessageModal('<i class="fa fa-github"></i> Import from Gist', 'Not a valid Gist URL :(', '', '', false)
    } else {
      ui.spinner.show()
      $.get('https://api.github.com/gists/' + wurl('-1', gisturl))
        .done(function (data) {
          if (data.files) {
            var contents = ''
            Object.keys(data.files).forEach(function (key) {
              contents += key
              contents += '\n---\n'
              contents += data.files[key].content
              contents += '\n\n'
            })
            replaceAll(contents)
          } else {
            showMessageModal('<i class="fa fa-github"></i> Import from Gist', 'Unable to fetch gist files :(', '', '', false)
          }
        })
        .fail(function (data) {
          showMessageModal('<i class="fa fa-github"></i> Import from Gist', 'Not a valid Gist URL :(', '', JSON.stringify(data), false)
        })
        .always(function () {
          ui.spinner.hide()
        })
    }
  }
})

// snippet import modal
$('#snippetImportModalClear').click(function () {
  $('#snippetImportModalContent').val('')
  $('#snippetImportModalProjects').val('init')
  $('#snippetImportModalSnippets').val('init')
  $('#snippetImportModalSnippets').prop('disabled', true)
})
$('#snippetImportModalConfirm').click(function () {
  var snippeturl = $('#snippetImportModalContent').val()
  if (!snippeturl) return
  $('#snippetImportModal').modal('hide')
  $('#snippetImportModalContent').val('')
  if (!/^.+\/snippets\/.+$/.test(snippeturl)) {
    showMessageModal('<i class="fa fa-github"></i> Import from Snippet', 'Not a valid Snippet URL :(', '', '', false)
  } else {
    ui.spinner.show()
    var accessToken = '?access_token=' + $('#snippetImportModalAccessToken').val()
    var fullURL = $('#snippetImportModalBaseURL').val() + '/api/' + $('#snippetImportModalVersion').val() + snippeturl
    $.get(fullURL + accessToken)
      .done(function (data) {
        var content = '# ' + (data.title || 'Snippet Import')
        var fileInfo = data.file_name.split('.')
        fileInfo[1] = (fileInfo[1]) ? fileInfo[1] : 'md'
        $.get(fullURL + '/raw' + accessToken)
          .done(function (raw) {
            if (raw) {
              content += '\n\n'
              if (fileInfo[1] !== 'md') {
                content += '```' + fileTypes[fileInfo[1]] + '\n'
              }
              content += raw
              if (fileInfo[1] !== 'md') {
                content += '\n```'
              }
              replaceAll(content)
            }
          })
          .fail(function (data) {
            showMessageModal('<i class="fa fa-gitlab"></i> Import from Snippet', 'Not a valid Snippet URL :(', '', JSON.stringify(data), false)
          })
          .always(function () {
            ui.spinner.hide()
          })
      })
      .fail(function (data) {
        showMessageModal('<i class="fa fa-gitlab"></i> Import from Snippet', 'Not a valid Snippet URL :(', '', JSON.stringify(data), false)
      })
  }
})

// snippet export modal
$('#snippetExportModalConfirm').click(function () {
  var accesstoken = $('#snippetExportModalAccessToken').val()
  var baseURL = $('#snippetExportModalBaseURL').val()
  var version = $('#snippetExportModalVersion').val()

  var data = {
    title: $('#snippetExportModalTitle').val(),
    file_name: $('#snippetExportModalFileName').val(),
    code: editor.getValue(),
    visibility_level: $('#snippetExportModalVisibility').val(),
    visibility: $('#snippetExportModalVisibility').val() === '0' ? 'private' : ($('#snippetExportModalVisibility').val() === '10' ? 'internal' : 'private')
  }

  if (!data.title || !data.file_name || !data.code || !data.visibility_level || !$('#snippetExportModalProjects').val()) return
  $('#snippetExportModalLoading').show()
  var fullURL = baseURL + '/api/' + version + '/projects/' + $('#snippetExportModalProjects').val() + '/snippets?access_token=' + accesstoken
  $.post(fullURL
    , data
    , function (ret) {
      $('#snippetExportModalLoading').hide()
      $('#snippetExportModal').modal('hide')
      var redirect = baseURL + '/' + $("#snippetExportModalProjects option[value='" + $('#snippetExportModalProjects').val() + "']").text() + '/snippets/' + ret.id
      showMessageModal('<i class="fa fa-gitlab"></i> Export to Snippet', 'Export Successful!', redirect, 'View Snippet Here', true)
    }
  )
})

function parseToEditor (data) {
  var turndownService = new TurndownService({
    defaultReplacement: function (innerHTML, node) {
      return node.isBlock ? '\n\n' + node.outerHTML + '\n\n' : node.outerHTML
    }
  })
  var parsed = turndownService.turndown(data)
  if (parsed) { replaceAll(parsed) }
}

function replaceAll (data) {
  editor.replaceRange(data, {
    line: 0,
    ch: 0
  }, {
    line: editor.lastLine(),
    ch: editor.lastLine().length
  }, '+input')
}

function importFromUrl (url) {
  // console.log(url);
  if (!url) return
  if (!isURL(url)) {
    showMessageModal('<i class="fa fa-cloud-download"></i> Import from URL', 'Not a valid URL :(', '', '', false)
    return
  }
  $.ajax({
    method: 'GET',
    url: url,
    success: function (data) {
      var extension = url.split('.').pop()
      if (extension === 'html') { parseToEditor(data) } else { replaceAll(data) }
    },
    error: function (data) {
      showMessageModal('<i class="fa fa-cloud-download"></i> Import from URL', 'Import failed :(', '', JSON.stringify(data), false)
    },
    complete: function () {
      ui.spinner.hide()
    }
  })
}

// mode
ui.toolbar.mode.click(function () {
  toggleMode()
})
// edit
ui.toolbar.edit.click(function () {
  changeMode(modeType.edit)
})
// view
ui.toolbar.view.click(function () {
  changeMode(modeType.view)
})
// both
ui.toolbar.both.click(function () {
  changeMode(modeType.both)
})

ui.toolbar.night.click(function () {
  toggleNightMode()
})
// permission
// freely
ui.infobar.permission.freely.click(function () {
  emitPermission('freely')
})
// editable
ui.infobar.permission.editable.click(function () {
  emitPermission('editable')
})
// locked
ui.infobar.permission.locked.click(function () {
  emitPermission('locked')
})
// private
ui.infobar.permission.private.click(function () {
  emitPermission('private')
})
// limited
ui.infobar.permission.limited.click(function () {
  emitPermission('limited')
})
// protected
ui.infobar.permission.protected.click(function () {
  emitPermission('protected')
})
// delete note
ui.infobar.delete.click(function () {
  $('.delete-modal').modal('show')
})
$('.ui-delete-modal-confirm').click(function () {
  socket.emit('delete')
})

function toggleNightMode () {
  var $body = $('body')
  var isActive = ui.toolbar.night.hasClass('active')
  if (isActive) {
    $body.removeClass('night')
    appState.nightMode = false
  } else {
    $body.addClass('night')
    appState.nightMode = true
  }
  if (store.enabled) {
    store.set('nightMode', !isActive)
  } else {
    Cookies.set('nightMode', !isActive, {
      expires: 365
    })
  }
}
function emitPermission (_permission) {
  if (_permission !== permission) {
    socket.emit('permission', _permission)
  }
}

function updatePermission (newPermission) {
  if (permission !== newPermission) {
    permission = newPermission
    if (window.loaded) refreshView()
  }
  ui.infobar.permission.label.hide()
  switch (permission) {
    case 'freely':
      $('#permissionLabelFreely').show()
      break
    case 'editable':
      $('#permissionLabelEditable').show()
      break
    case 'limited':
      $('#permissionLabelLimited').show()
      break
    case 'locked':
      $('#permissionLabelLocked').show()
      break
    case 'protected':
      $('#permissionLabelProtected').show()
      break
    case 'private':
      $('#permissionLabelPrivate').show()
      break
  }
  if (personalInfo.userid && window.owner && personalInfo.userid === window.owner) {
    ui.infobar.permission.labelCaretDown.show()
    ui.infobar.permission.label.removeClass('disabled')
  } else {
    ui.infobar.permission.labelCaretDown.hide()
    ui.infobar.permission.label.addClass('disabled')
  }
}

function havePermission () {
  var bool = false
  switch (permission) {
    case 'freely':
      bool = true
      break
    case 'editable':
    case 'limited':
      if (!personalInfo.login) {
        bool = false
      } else {
        bool = true
      }
      break
    case 'locked':
    case 'private':
    case 'protected':
      if (!window.owner || personalInfo.userid !== window.owner) {
        bool = false
      } else {
        bool = true
      }
      break
  }
  return bool
}
// global module workaround
window.havePermission = havePermission

// socket.io actions
var io = require('socket.io-client')
var socket = io.connect({
  path: urlpath ? '/' + urlpath + '/socket.io/' : '',
  query: {
    noteId: noteid
  },
  timeout: 5000, // 5 secs to timeout,
  reconnectionAttempts: 20 // retry 20 times on connect failed
})
// overwrite original event for checking login state
var on = socket.on
socket.on = function () {
  if (!checkLoginStateChanged() && !needRefresh) { return on.apply(socket, arguments) }
}
var emit = socket.emit
socket.emit = function () {
  if (!checkLoginStateChanged() && !needRefresh) { emit.apply(socket, arguments) }
}
socket.on('info', function (data) {
  console.error(data)
  switch (data.code) {
    case 403:
      location.href = serverurl + '/403'
      break
    case 404:
      location.href = serverurl + '/404'
      break
    case 500:
      location.href = serverurl + '/500'
      break
  }
})
socket.on('error', function (data) {
  console.error(data)
  if (data.message && data.message.indexOf('AUTH failed') === 0) { location.href = serverurl + '/403' }
})
socket.on('delete', function () {
  if (personalInfo.login) {
    deleteServerHistory(noteid, function (err, data) {
      if (!err) location.href = serverurl
    })
  } else {
    getHistory(function (notehistory) {
      var newnotehistory = removeHistory(noteid, notehistory)
      saveHistory(newnotehistory)
      location.href = serverurl
    })
  }
})
var retryTimer = null
socket.on('maintenance', function () {
  cmClient.revision = -1
})
socket.on('disconnect', function (data) {
  console.log('断开连接，进入离线模式');
  
  // 1. 首先确保设置离线模式状态
  isOfflineMode = true;
  
  // 2. 立即解除编辑器只读状态，确保用户可以继续编辑
  // 无论后续操作是否成功，都先确保编辑器可用
  if (editor.getOption('readOnly')) {
    console.log('解除编辑器只读状态');
    editor.setOption('readOnly', false);
  }
  
  // 3. 更新UI状态
  showStatus(statusType.offline);
  
  // 4. 显示离线编辑状态指示器
  updateOfflineIndicator(true);
  
  // 5. 保存当前状态
  if (window.loaded) {
    saveInfo();
    lastInfo.history = editor.getHistory();
    
    // 检查是否支持离线模式
    if ('serviceWorker' in navigator) {
      // 保存当前文档到IndexedDB
      const content = editor.getValue();
      const noteId = noteid;
      
      // 即使保存失败也不影响编辑
      idbManager.saveEditorState(noteId, content, cmClient ? cmClient.revision : -1, lastInfo)
        .then(() => {
          console.log('文档状态已保存到本地存储');
          
          // 显示离线模式提醒
          showTemporaryNotification('<i class="fa fa-exclamation-triangle"></i> 网络断开，已进入离线编辑模式');
          
          // 向Service Worker缓存当前内容
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
              type: 'CACHE_NOTE',
              noteId: noteId,
              content: content
            });
          }
        })
        .catch(err => {
          console.error('保存文档到本地存储失败:', err);
          // 即使保存失败，也显示离线模式通知
          showTemporaryNotification('<i class="fa fa-exclamation-triangle"></i> 网络断开，进入离线编辑模式（本地存储失败）', 'warning');
        });
    }
  } else {
    // 未加载完成，尝试从IndexedDB恢复内容
    idbManager.getNoteSnapshot(noteid)
      .then(snapshot => {
        if (snapshot) {
          console.log('从本地存储恢复笔记内容');
          
          // 设置内容
          editor.setValue(snapshot.content);
          
          // 恢复历史记录和状态
          if (snapshot.metadata && snapshot.metadata.lastInfo) {
            // 不能直接赋值给lastInfo（常量），而是复制其属性
            if (snapshot.metadata.lastInfo.history) {
              editor.setHistory(snapshot.metadata.lastInfo.history);
            }
            
            // 复制其他属性
            for (const key in snapshot.metadata.lastInfo) {
              if (key !== 'history' && Object.prototype.hasOwnProperty.call(snapshot.metadata.lastInfo, key)) {
                lastInfo[key] = snapshot.metadata.lastInfo[key];
              }
            }
          }
          
          // 显示离线模式通知
          showTemporaryNotification('<i class="fa fa-exclamation-triangle"></i> 已从本地存储加载笔记', 'info', 5000);
          
          // 标记为已加载
          window.loaded = true;
          ui.spinner.hide();
          ui.content.fadeIn();
        }
      })
      .catch(err => {
        console.error('恢复离线内容失败:', err);
        // 即使恢复失败，仍保持离线编辑模式
        showTemporaryNotification('<i class="fa fa-exclamation-triangle"></i> 恢复本地内容失败，但您仍可编辑', 'danger', 5000);
      });
  }
  
  // 6. 设置重连定时器
  if (!retryTimer) {
    retryTimer = setInterval(function () {
      if (!needRefresh) socket.connect();
    }, 1000);
  }
})
socket.on('reconnect', function (data) {
  clearInterval(retryTimer)
  retryTimer = null
  
  console.log('socket重新连接成功');
  
  // 从离线模式恢复
  if (isOfflineMode) {
    // 显示正在同步的通知
    showTemporaryNotification('<i class="fa fa-sync fa-spin"></i> 网络已恢复，正在同步更改...', 'info');
    
    // 更改在线状态显示
    showStatus(statusType.connected);
    
    // 更新用户状态
    emitUserStatus(true);
    
    // 确保服务器知道我们在线
    socket.emit('online users');
    
    // 同步离线编辑的内容
    syncOfflineChanges().then(() => {
      console.log('离线更改同步成功');
      
      // 再次强制刷新确保同步成功
      return forceRefreshDocument();
    }).then(() => {
      // 同步完成，更新通知
      showTemporaryNotification('<i class="fa fa-check"></i> 所有更改已同步', 'success');
      
      // 确保显示为在线状态
      showStatus(statusType.online, onlineUsers.length);
      
      // 同步成功后，移除离线编辑状态指示器
      updateOfflineIndicator(false);
      
      // 重置离线状态
      isOfflineMode = false;
      
      // 重置离线操作队列
      offlineOperations = [];
      
      // 清除IndexedDB中的离线操作
      idbManager.clearPendingOperations(noteid)
        .then(() => console.log('清除了离线操作缓存'))
        .catch(err => console.warn('清除离线操作失败:', err));
    }).catch(err => {
      console.error('同步离线更改失败:', err);
      
      // 即使同步失败，也要继续正常操作
      showTemporaryNotification('<i class="fa fa-exclamation-triangle"></i> 同步部分更改失败，但您可以继续编辑', 'warning');
      
      // 确保显示为在线状态
      showStatus(statusType.online, onlineUsers.length);
      
      // 移除离线指示器
      updateOfflineIndicator(false);
      
      // 恢复正常状态
      isOfflineMode = false;
      
      // 确保可以继续编辑
      if (editor.getOption('readOnly')) {
        editor.setOption('readOnly', false);
      }
    });
  } else {
    // 确保显示为在线状态
    showStatus(statusType.online, onlineUsers.length);
  }
  
  // sync back any change in offline
  emitUserStatus(true)
  cursorActivity(editor)
  socket.emit('online users')
})
socket.on('connect', function (data) {
  clearInterval(retryTimer)
  retryTimer = null
  personalInfo.id = socket.id
  showStatus(statusType.connected)
  socket.emit('version')
})
socket.on('version', function (data) {
  if (version !== data.version) {
    if (version < data.minimumCompatibleVersion) {
      setRefreshModal('incompatible-version')
      setNeedRefresh()
    } else {
      setRefreshModal('new-version')
    }
  }
})
var authors = []
var authorship = []
var authorMarks = {} // temp variable
var addTextMarkers = [] // temp variable
function updateInfo (data) {
  // console.log(data);
  if (Object.hasOwnProperty.call(data, 'createtime') && window.createtime !== data.createtime) {
    window.createtime = data.createtime
    updateLastChange()
  }
  if (Object.hasOwnProperty.call(data, 'updatetime') && window.lastchangetime !== data.updatetime) {
    window.lastchangetime = data.updatetime
    updateLastChange()
  }
  if (Object.hasOwnProperty.call(data, 'owner') && window.owner !== data.owner) {
    window.owner = data.owner
    window.ownerprofile = data.ownerprofile
    updateOwner()
  }
  if (Object.hasOwnProperty.call(data, 'lastchangeuser') && window.lastchangeuser !== data.lastchangeuser) {
    window.lastchangeuser = data.lastchangeuser
    window.lastchangeuserprofile = data.lastchangeuserprofile
    updateLastChangeUser()
    updateOwner()
  }
  if (Object.hasOwnProperty.call(data, 'authors') && authors !== data.authors) {
    authors = data.authors
  }
  if (Object.hasOwnProperty.call(data, 'authorship') && authorship !== data.authorship) {
    authorship = data.authorship
    updateAuthorship()
  }
}
var updateAuthorship = _.debounce(function () {
  editor.operation(updateAuthorshipInner)
}, 50)
function initMark () {
  return {
    gutter: {
      userid: null,
      timestamp: null
    },
    textmarkers: []
  }
}
function initMarkAndCheckGutter (mark, author, timestamp) {
  if (!mark) mark = initMark()
  if (!mark.gutter.userid || mark.gutter.timestamp > timestamp) {
    mark.gutter.userid = author.userid
    mark.gutter.timestamp = timestamp
  }
  return mark
}
var addStyleRule = (function () {
  var added = {}
  var styleElement = document.createElement('style')
  document.documentElement.getElementsByTagName('head')[0].appendChild(styleElement)
  var styleSheet = styleElement.sheet

  return function (css) {
    if (added[css]) {
      return
    }
    added[css] = true
    styleSheet.insertRule(css, (styleSheet.cssRules || styleSheet.rules).length)
  }
}())
function updateAuthorshipInner () {
  // ignore when ot not synced yet
  if (havePendingOperation()) return
  authorMarks = {}
  for (let i = 0; i < authorship.length; i++) {
    var atom = authorship[i]
    const author = authors[atom[0]]
    if (author) {
      var prePos = editor.posFromIndex(atom[1])
      var preLine = editor.getLine(prePos.line)
      var postPos = editor.posFromIndex(atom[2])
      var postLine = editor.getLine(postPos.line)
      if (prePos.ch === 0 && postPos.ch === postLine.length) {
        for (let j = prePos.line; j <= postPos.line; j++) {
          if (editor.getLine(j)) {
            authorMarks[j] = initMarkAndCheckGutter(authorMarks[j], author, atom[3])
          }
        }
      } else if (postPos.line - prePos.line >= 1) {
        var startLine = prePos.line
        var endLine = postPos.line
        if (prePos.ch === preLine.length) {
          startLine++
        } else if (prePos.ch !== 0) {
          const mark = initMarkAndCheckGutter(authorMarks[prePos.line], author, atom[3])
          var _postPos = {
            line: prePos.line,
            ch: preLine.length
          }
          if (JSON.stringify(prePos) !== JSON.stringify(_postPos)) {
            mark.textmarkers.push({
              userid: author.userid,
              pos: [prePos, _postPos]
            })
            startLine++
          }
          authorMarks[prePos.line] = mark
        }
        if (postPos.ch === 0) {
          endLine--
        } else if (postPos.ch !== postLine.length) {
          const mark = initMarkAndCheckGutter(authorMarks[postPos.line], author, atom[3])
          var _prePos = {
            line: postPos.line,
            ch: 0
          }
          if (JSON.stringify(_prePos) !== JSON.stringify(postPos)) {
            mark.textmarkers.push({
              userid: author.userid,
              pos: [_prePos, postPos]
            })
            endLine--
          }
          authorMarks[postPos.line] = mark
        }
        for (let j = startLine; j <= endLine; j++) {
          if (editor.getLine(j)) {
            authorMarks[j] = initMarkAndCheckGutter(authorMarks[j], author, atom[3])
          }
        }
      } else {
        const mark = initMarkAndCheckGutter(authorMarks[prePos.line], author, atom[3])
        if (JSON.stringify(prePos) !== JSON.stringify(postPos)) {
          mark.textmarkers.push({
            userid: author.userid,
            pos: [prePos, postPos]
          })
        }
        authorMarks[prePos.line] = mark
      }
    }
  }
  addTextMarkers = []
  editor.eachLine(iterateLine)
  const allTextMarks = editor.getAllMarks()
  for (let i = 0; i < allTextMarks.length; i++) {
    const _textMarker = allTextMarks[i]
    const pos = _textMarker.find()
    let found = false
    for (let j = 0; j < addTextMarkers.length; j++) {
      const textMarker = addTextMarkers[j]
      const author = authors[textMarker.userid]
      const className = 'authorship-inline-' + author.color.substr(1)
      var obj = {
        from: textMarker.pos[0],
        to: textMarker.pos[1]
      }
      if (JSON.stringify(pos) === JSON.stringify(obj) && _textMarker.className &&
                _textMarker.className.indexOf(className) > -1) {
        addTextMarkers.splice(j, 1)
        j--
        found = true
        break
      }
    }
    if (!found && _textMarker.className && _textMarker.className.indexOf('authorship-inline') > -1) {
      _textMarker.clear()
    }
  }
  for (let i = 0; i < addTextMarkers.length; i++) {
    const textMarker = addTextMarkers[i]
    const author = authors[textMarker.userid]
    const rgbcolor = hex2rgb(author.color)
    const colorString = `rgba(${rgbcolor.red},${rgbcolor.green},${rgbcolor.blue},0.7)`
    const styleString = `background-image: linear-gradient(to top, ${colorString} 1px, transparent 1px);`
    const className = `authorship-inline-${author.color.substr(1)}`
    const rule = `.${className} { ${styleString} }`
    addStyleRule(rule)
    editor.markText(textMarker.pos[0], textMarker.pos[1], {
      className: 'authorship-inline ' + className,
      title: author.name
    })
  }
}
function iterateLine (line) {
  const lineNumber = line.lineNo()
  const currMark = authorMarks[lineNumber]
  const author = currMark ? authors[currMark.gutter.userid] : null
  if (currMark && author) {
    const className = 'authorship-gutter-' + author.color.substr(1)
    const gutters = line.gutterMarkers
    if (!gutters || !gutters['authorship-gutters'] ||
        !gutters['authorship-gutters'].className ||
        !gutters['authorship-gutters'].className.indexOf(className) < 0) {
      const styleString = `border-left: 3px solid ${author.color}; height: ${defaultTextHeight}px; margin-left: 3px;`
      const rule = `.${className} { ${styleString} }`
      addStyleRule(rule)
      const gutter = $('<div>', {
        class: 'authorship-gutter ' + className,
        title: author.name
      })
      editor.setGutterMarker(line, 'authorship-gutters', gutter[0])
    }
  } else {
    editor.setGutterMarker(line, 'authorship-gutters', null)
  }
  if (currMark && currMark.textmarkers.length > 0) {
    for (let i = 0; i < currMark.textmarkers.length; i++) {
      const textMarker = currMark.textmarkers[i]
      if (textMarker.userid !== currMark.gutter.userid) {
        addTextMarkers.push(textMarker)
      }
    }
  }
}
editorInstance.on('update', function () {
  $('.authorship-gutter:not([data-original-title])').tooltip({
    container: '.CodeMirror-lines',
    placement: 'right',
    delay: { show: 500, hide: 100 }
  })
  $('.authorship-inline:not([data-original-title])').tooltip({
    container: '.CodeMirror-lines',
    placement: 'bottom',
    delay: { show: 500, hide: 100 }
  })
  // clear tooltip which described element has been removed
  $('[id^="tooltip"]').each(function (index, element) {
    var $ele = $(element)
    if ($('[aria-describedby="' + $ele.attr('id') + '"]').length <= 0) $ele.remove()
  })
})
socket.on('check', function (data) {
  // console.log(data);
  updateInfo(data)
})
socket.on('permission', function (data) {
  updatePermission(data.permission)
})

var permission = null
socket.on('refresh', function (data) {
  // console.log(data);
  editorInstance.config.docmaxlength = data.docmaxlength
  editor.setOption('maxLength', editorInstance.config.docmaxlength)
  updateInfo(data)
  updatePermission(data.permission)
  if (!window.loaded) {
    // auto change mode if no content detected
    var nocontent = editor.getValue().length <= 0
    if (nocontent) {
      if (visibleXS) { appState.currentMode = modeType.edit } else { appState.currentMode = modeType.both }
    }
    // parse mode from url
    if (window.location.search.length > 0) {
      var urlMode = modeType[window.location.search.substr(1)]
      if (urlMode) appState.currentMode = urlMode
    }
    changeMode(appState.currentMode)
    if (nocontent && !visibleXS) {
      editor.focus()
      editor.refresh()
    }
    updateViewInner() // bring up view rendering earlier
    updateHistory() // update history whether have content or not
    window.loaded = true
    emitUserStatus() // send first user status
    updateOnlineStatus() // update first online status
    setTimeout(function () {
      // work around editor not refresh or doc not fully loaded
      windowResizeInner()
      // work around might not scroll to hash
      scrollToHash()
    }, 1)
  }
  if (editor.getOption('readOnly')) { editor.setOption('readOnly', false) }
})

var EditorClient = ot.EditorClient
var SocketIOAdapter = ot.SocketIOAdapter
var CodeMirrorAdapter = ot.CodeMirrorAdapter
var cmClient = null
var synchronized_ = null

function havePendingOperation () {
  // 离线模式下，允许继续编辑，不报告有等待操作
  if (isOfflineMode) {
    return false;
  }
  
  // 原始代码逻辑
  return !!((cmClient && cmClient.state && Object.hasOwnProperty.call(cmClient.state, 'outstanding')))
}

socket.on('doc', function (obj) {
  var body = obj.str
  var bodyMismatch = editor.getValue() !== body
  var setDoc = !cmClient || (cmClient && (cmClient.revision === -1 || (cmClient.revision !== obj.revision && !havePendingOperation()))) || obj.force

  saveInfo()
  if (setDoc && bodyMismatch) {
    if (cmClient) cmClient.editorAdapter.ignoreNextChange = true
    if (body) editor.setValue(body)
    else editor.setValue('')
  }

  if (!window.loaded) {
    editor.clearHistory()
    ui.spinner.hide()
    ui.content.fadeIn()
  } else {
    // if current doc is equal to the doc before disconnect
    if (setDoc && bodyMismatch) editor.clearHistory()
    else if (lastInfo.history) editor.setHistory(lastInfo.history)
    lastInfo.history = null
  }

  if (!cmClient) {
    cmClient = window.cmClient = new EditorClient(
      obj.revision, obj.clients,
      new SocketIOAdapter(socket), new CodeMirrorAdapter(editor)
    )
    synchronized_ = cmClient.state
  } else if (setDoc) {
    if (bodyMismatch) {
      cmClient.undoManager.undoStack.length = 0
      cmClient.undoManager.redoStack.length = 0
    }
    cmClient.revision = obj.revision
    cmClient.setState(synchronized_)
    cmClient.initializeClientList()
    cmClient.initializeClients(obj.clients)
  } else if (havePendingOperation()) {
    cmClient.serverReconnect()
  }

  if (setDoc && bodyMismatch) {
    isDirty = true
    updateView()
  }

  restoreInfo()
})

socket.on('ack', function () {
  isDirty = true
  updateView()
})

socket.on('operation', function () {
  isDirty = true
  updateView()
})

socket.on('online users', function (data) {
  if (debug) { console.debug(data) }
  onlineUsers = data.users
  updateOnlineStatus()
  $('.CodeMirror-other-cursors').children().each(function (key, value) {
    var found = false
    for (var i = 0; i < data.users.length; i++) {
      var user = data.users[i]
      if ($(this).attr('id') === user.id) { found = true }
    }
    if (!found) {
      $(this).stop(true).fadeOut('normal', function () {
        $(this).remove()
      })
    }
  })
  for (var i = 0; i < data.users.length; i++) {
    var user = data.users[i]
    if (user.id !== socket.id) { buildCursor(user) } else { personalInfo = user }
  }
})
socket.on('user status', function (data) {
  if (debug) { console.debug(data) }
  for (var i = 0; i < onlineUsers.length; i++) {
    if (onlineUsers[i].id === data.id) {
      onlineUsers[i] = data
    }
  }
  updateOnlineStatus()
  if (data.id !== socket.id) { buildCursor(data) }
})
socket.on('cursor focus', function (data) {
  if (debug) { console.debug(data) }
  for (var i = 0; i < onlineUsers.length; i++) {
    if (onlineUsers[i].id === data.id) {
      onlineUsers[i].cursor = data.cursor
    }
  }
  if (data.id !== socket.id) { buildCursor(data) }
  // force show
  var cursor = $('div[data-clientid="' + data.id + '"]')
  if (cursor.length > 0) {
    cursor.stop(true).fadeIn()
  }
})
socket.on('cursor activity', function (data) {
  if (debug) { console.debug(data) }
  for (var i = 0; i < onlineUsers.length; i++) {
    if (onlineUsers[i].id === data.id) {
      onlineUsers[i].cursor = data.cursor
    }
  }
  if (data.id !== socket.id) { buildCursor(data) }
})
socket.on('cursor blur', function (data) {
  if (debug) { console.debug(data) }
  for (var i = 0; i < onlineUsers.length; i++) {
    if (onlineUsers[i].id === data.id) {
      onlineUsers[i].cursor = null
    }
  }
  if (data.id !== socket.id) { buildCursor(data) }
  // force hide
  var cursor = $('div[data-clientid="' + data.id + '"]')
  if (cursor.length > 0) {
    cursor.stop(true).fadeOut()
  }
})

var options = {
  valueNames: ['id', 'name'],
  item: '<li class="ui-user-item">' +
        '<span class="id" style="display:none;"></span>' +
        '<a href="#">' +
            '<span class="pull-left"><i class="ui-user-icon"></i></span><span class="ui-user-name name"></span><span class="pull-right"><i class="fa fa-circle ui-user-status"></i></span>' +
        '</a>' +
        '</li>'
}
var onlineUserList = new List('online-user-list', options)
var shortOnlineUserList = new List('short-online-user-list', options)

function updateOnlineStatus () {
  if (!window.loaded || !socket.connected) return
  var _onlineUsers = deduplicateOnlineUsers(onlineUsers)
  showStatus(statusType.online, _onlineUsers.length)
  var items = onlineUserList.items
  // update or remove current list items
  for (let i = 0; i < items.length; i++) {
    let found = false
    let foundindex = null
    for (let j = 0; j < _onlineUsers.length; j++) {
      if (items[i].values().id === _onlineUsers[j].id) {
        foundindex = j
        found = true
        break
      }
    }
    const id = items[i].values().id
    if (found) {
      onlineUserList.get('id', id)[0].values(_onlineUsers[foundindex])
      shortOnlineUserList.get('id', id)[0].values(_onlineUsers[foundindex])
    } else {
      onlineUserList.remove('id', id)
      shortOnlineUserList.remove('id', id)
    }
  }
  // add not in list items
  for (let i = 0; i < _onlineUsers.length; i++) {
    let found = false
    for (let j = 0; j < items.length; j++) {
      if (items[j].values().id === _onlineUsers[i].id) {
        found = true
        break
      }
    }
    if (!found) {
      onlineUserList.add(_onlineUsers[i])
      shortOnlineUserList.add(_onlineUsers[i])
    }
  }
  // sorting
  sortOnlineUserList(onlineUserList)
  sortOnlineUserList(shortOnlineUserList)
  // render list items
  renderUserStatusList(onlineUserList)
  renderUserStatusList(shortOnlineUserList)
}

function sortOnlineUserList (list) {
  // sort order by isSelf, login state, idle state, alphabet name, color brightness
  list.sort('', {
    sortFunction: function (a, b) {
      var usera = a.values()
      var userb = b.values()
      var useraIsSelf = (usera.id === personalInfo.id || (usera.login && usera.userid === personalInfo.userid))
      var userbIsSelf = (userb.id === personalInfo.id || (userb.login && userb.userid === personalInfo.userid))
      if (useraIsSelf && !userbIsSelf) {
        return -1
      } else if (!useraIsSelf && userbIsSelf) {
        return 1
      } else {
        if (usera.login && !userb.login) { return -1 } else if (!usera.login && userb.login) { return 1 } else {
          if (!usera.idle && userb.idle) { return -1 } else if (usera.idle && !userb.idle) { return 1 } else {
            if (usera.name && userb.name && usera.name.toLowerCase() < userb.name.toLowerCase()) {
              return -1
            } else if (usera.name && userb.name && usera.name.toLowerCase() > userb.name.toLowerCase()) {
              return 1
            } else {
              if (usera.color && userb.color && usera.color.toLowerCase() < userb.color.toLowerCase()) { return -1 } else if (usera.color && userb.color && usera.color.toLowerCase() > userb.color.toLowerCase()) { return 1 } else { return 0 }
            }
          }
        }
      }
    }
  })
}

function renderUserStatusList (list) {
  var items = list.items
  for (var j = 0; j < items.length; j++) {
    var item = items[j]
    var userstatus = $(item.elm).find('.ui-user-status')
    var usericon = $(item.elm).find('.ui-user-icon')
    if (item.values().login && item.values().photo) {
      usericon.css('background-image', 'url(' + item.values().photo + ')')
      // add 1px more to right, make it feel aligned
      usericon.css('margin-right', '6px')
      $(item.elm).css('border-left', '4px solid ' + item.values().color)
      usericon.css('margin-left', '-4px')
    } else {
      usericon.css('background-color', item.values().color)
    }
    userstatus.removeClass('ui-user-status-offline ui-user-status-online ui-user-status-idle')
    if (item.values().idle) { userstatus.addClass('ui-user-status-idle') } else { userstatus.addClass('ui-user-status-online') }
  }
}

function deduplicateOnlineUsers (list) {
  var _onlineUsers = []
  for (var i = 0; i < list.length; i++) {
    var user = $.extend({}, list[i])
    if (!user.userid) { _onlineUsers.push(user) } else {
      var found = false
      for (var j = 0; j < _onlineUsers.length; j++) {
        if (_onlineUsers[j].userid === user.userid) {
          // keep self color when login
          if (user.id === personalInfo.id) {
            _onlineUsers[j].color = user.color
          }
          // keep idle state if any of self client not idle
          if (!user.idle) {
            _onlineUsers[j].idle = user.idle
            _onlineUsers[j].color = user.color
          }
          found = true
          break
        }
      }
      if (!found) { _onlineUsers.push(user) }
    }
  }
  return _onlineUsers
}

var userStatusCache = null

function emitUserStatus (force) {
  if (!window.loaded) return
  var type = null
  if (visibleXS) { type = 'xs' } else if (visibleSM) { type = 'sm' } else if (visibleMD) { type = 'md' } else if (visibleLG) { type = 'lg' }

  personalInfo.idle = idle.isAway
  personalInfo.type = type

  for (var i = 0; i < onlineUsers.length; i++) {
    if (onlineUsers[i].id === personalInfo.id) {
      onlineUsers[i] = personalInfo
    }
  }

  var userStatus = {
    idle: idle.isAway,
    type: type
  }

  if (force || JSON.stringify(userStatus) !== JSON.stringify(userStatusCache)) {
    socket.emit('user status', userStatus)
    userStatusCache = userStatus
  }
}

function checkCursorTag (coord, ele) {
  if (!ele) return // return if element not exists
  // set margin
  var tagRightMargin = 0
  var tagBottomMargin = 2
  // use sizer to get the real doc size (won't count status bar and gutters)
  var docWidth = ui.area.codemirrorSizer.width()
  // get editor size (status bar not count in)
  var editorHeight = ui.area.codemirror.height()
  // get element size
  var width = ele.outerWidth()
  var height = ele.outerHeight()
  var padding = (ele.outerWidth() - ele.width()) / 2
  // get coord position
  var left = coord.left
  var top = coord.top
  // get doc top offset (to workaround with viewport)
  var docTopOffset = ui.area.codemirrorSizerInner.position().top
  // set offset
  var offsetLeft = -3
  var offsetTop = defaultTextHeight
  // only do when have width and height
  if (width > 0 && height > 0) {
    // flip x when element right bound larger than doc width
    if (left + width + offsetLeft + tagRightMargin > docWidth) {
      offsetLeft = -(width + tagRightMargin) + padding + offsetLeft
    }
    // flip y when element bottom bound larger than doc height
    // and element top position is larger than element height
    if (top + docTopOffset + height + offsetTop + tagBottomMargin > Math.max(editor.doc.height, editorHeight) && top + docTopOffset > height + tagBottomMargin) {
      offsetTop = -(height)
    }
  }
  // set position
  ele[0].style.left = offsetLeft + 'px'
  ele[0].style.top = offsetTop + 'px'
}

function buildCursor (user) {
  if (appState.currentMode === modeType.view) return
  if (!user.cursor) return
  var coord = editor.charCoords(user.cursor, 'windows')
  coord.left = coord.left < 4 ? 4 : coord.left
  coord.top = coord.top < 0 ? 0 : coord.top
  var iconClass = 'fa-user'
  switch (user.type) {
    case 'xs':
      iconClass = 'fa-mobile'
      break
    case 'sm':
      iconClass = 'fa-tablet'
      break
    case 'md':
      iconClass = 'fa-desktop'
      break
    case 'lg':
      iconClass = 'fa-desktop'
      break
  }
  if ($('div[data-clientid="' + user.id + '"]').length <= 0) {
    const cursor = $('<div data-clientid="' + user.id + '" class="CodeMirror-other-cursor" style="display:none;"></div>')
    cursor.attr('data-line', user.cursor.line)
    cursor.attr('data-ch', user.cursor.ch)
    cursor.attr('data-offset-left', 0)
    cursor.attr('data-offset-top', 0)

    const cursorbar = $('<div class="cursorbar">&nbsp;</div>')
    cursorbar[0].style.height = defaultTextHeight + 'px'
    cursorbar[0].style.borderLeft = '2px solid ' + user.color

    var icon = '<i class="fa ' + iconClass + '"></i>'

    const cursortag = $('<div class="cursortag">' + icon + '&nbsp;<span class="name">' + user.name + '</span></div>')
    // cursortag[0].style.background = color;
    cursortag[0].style.color = user.color

    cursor.attr('data-mode', 'hover')
    cursortag.delay(2000).fadeOut('fast')
    cursor.hover(
      function () {
        if (cursor.attr('data-mode') === 'hover') { cursortag.stop(true).fadeIn('fast') }
      },
      function () {
        if (cursor.attr('data-mode') === 'hover') { cursortag.stop(true).fadeOut('fast') }
      })

    var hideCursorTagDelay = 2000
    var hideCursorTagTimer = null

    var switchMode = function (ele) {
      if (ele.attr('data-mode') === 'state') { ele.attr('data-mode', 'hover') } else if (ele.attr('data-mode') === 'hover') { ele.attr('data-mode', 'state') }
    }

    var switchTag = function (ele) {
      if (ele.css('display') === 'none') { ele.stop(true).fadeIn('fast') } else { ele.stop(true).fadeOut('fast') }
    }

    var hideCursorTag = function () {
      if (cursor.attr('data-mode') === 'hover') { cursortag.fadeOut('fast') }
    }
    cursor.on('touchstart', function (e) {
      var display = cursortag.css('display')
      cursortag.stop(true).fadeIn('fast')
      clearTimeout(hideCursorTagTimer)
      hideCursorTagTimer = setTimeout(hideCursorTag, hideCursorTagDelay)
      if (display === 'none') {
        e.preventDefault()
        e.stopPropagation()
      }
    })
    cursortag.on('mousedown touchstart', function (e) {
      if (cursor.attr('data-mode') === 'state') { switchTag(cursortag) }
      switchMode(cursor)
      e.preventDefault()
      e.stopPropagation()
    })

    cursor.append(cursorbar)
    cursor.append(cursortag)

    cursor[0].style.left = coord.left + 'px'
    cursor[0].style.top = coord.top + 'px'
    $('.CodeMirror-other-cursors').append(cursor)

    if (!user.idle) { cursor.stop(true).fadeIn() }

    checkCursorTag(coord, cursortag)
  } else {
    const cursor = $('div[data-clientid="' + user.id + '"]')
    cursor.attr('data-line', user.cursor.line)
    cursor.attr('data-ch', user.cursor.ch)

    const cursorbar = cursor.find('.cursorbar')
    cursorbar[0].style.height = defaultTextHeight + 'px'
    cursorbar[0].style.borderLeft = '2px solid ' + user.color

    const cursortag = cursor.find('.cursortag')
    cursortag.find('i').removeClass().addClass('fa').addClass(iconClass)
    cursortag.find('.name').text(user.name)

    if (cursor.css('display') === 'none') {
      cursor[0].style.left = coord.left + 'px'
      cursor[0].style.top = coord.top + 'px'
    } else {
      cursor.animate({
        left: coord.left,
        top: coord.top
      }, {
        duration: cursorAnimatePeriod,
        queue: false
      })
    }

    if (user.idle && cursor.css('display') !== 'none') { cursor.stop(true).fadeOut() } else if (!user.idle && cursor.css('display') === 'none') { cursor.stop(true).fadeIn() }

    checkCursorTag(coord, cursortag)
  }
}

// editor actions
function removeNullByte (cm, change) {
  var str = change.text.join('\n')
  // eslint-disable-next-line no-control-regex
  if (/\u0000/g.test(str) && change.update) {
    // eslint-disable-next-line no-control-regex
    change.update(change.from, change.to, str.replace(/\u0000/g, '').split('\n'))
  }
}
function enforceMaxLength (cm, change) {
  var maxLength = cm.getOption('maxLength')
  if (maxLength && change.update) {
    var str = change.text.join('\n')
    var delta = str.length - (cm.indexFromPos(change.to) - cm.indexFromPos(change.from))
    if (delta <= 0) {
      return false
    }
    delta = cm.getValue().length + delta - maxLength
    if (delta > 0) {
      str = str.substr(0, str.length - delta)
      change.update(change.from, change.to, str.split('\n'))
      return true
    }
  }
  return false
}
let lastDocHeight
var ignoreEmitEvents = ['setValue', 'ignoreHistory']
editorInstance.on('beforeChange', function (cm, change) {
  if (debug) { console.debug(change) }
  lastDocHeight = editor.doc.height
  removeNullByte(cm, change)
  if (enforceMaxLength(cm, change)) {
    $('.limit-modal').modal('show')
  }
  var isIgnoreEmitEvent = (ignoreEmitEvents.indexOf(change.origin) !== -1)
  if (!isIgnoreEmitEvent) {
    // 修改：添加离线模式检查，如果是离线模式始终允许编辑
    if (!isOfflineMode && !havePermission()) {
      console.log('取消编辑：没有权限且不是离线模式');
      change.canceled = true
      switch (permission) {
        case 'editable':
          $('.signin-modal').modal('show')
          break
        case 'locked':
        case 'private':
          $('.locked-modal').modal('show')
          break
      }
    }
  } else {
    if (change.origin === 'ignoreHistory') {
      setHaveUnreadChanges(true)
      updateTitleReminder()
    }
  }
  
  // 修改：离线模式下不需要忽略下一次改变
  if (cmClient && !socket.connected && !isOfflineMode) { 
    cmClient.editorAdapter.ignoreNextChange = true 
  }
})
editorInstance.on('cut', function () {
  // na
})
editorInstance.on('paste', function () {
  // na
})
editorInstance.on('changes', function (editor, changes) {
  const docHeightChanged = editor.doc.height !== lastDocHeight
  updateHistory()
  var docLength = editor.getValue().length
  
  // 在离线模式下记录操作
  if (isOfflineMode) {
    // 记录更改到IndexedDB
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      // 忽略setValue和ignoreHistory触发的变更
      if (ignoreEmitEvents.indexOf(change.origin) !== -1) continue;
      
      // 记录操作
      const operation = {
        from: change.from,
        to: change.to,
        text: change.text,
        removed: change.removed,
        origin: change.origin,
        timestamp: Date.now()
      };
      
      // 添加到本地操作队列
      offlineOperations.push(operation);
      
      // 保存到IndexedDB
      idbManager.queueOperation(noteid, operation)
        .then(() => console.log('操作已保存到队列'))
        .catch(err => console.error('保存操作到队列失败:', err));
    }
  }
  
  // workaround for big documents
  var newViewportMargin = 20
  if (docLength > 20000) {
    newViewportMargin = 1
  } else if (docLength > 10000) {
    newViewportMargin = 10
  } else if (docLength > 5000) {
    newViewportMargin = 15
  }
  if (newViewportMargin !== viewportMargin) {
    viewportMargin = newViewportMargin
    windowResize()
  }
  if (docHeightChanged) {
    checkEditorScrollbar()
    checkEditorScrollOverLines()
    // always sync edit scrolling to view if user is editing
    if (ui.area.codemirrorScroll[0].scrollHeight > ui.area.view[0].scrollHeight && editorHasFocus()) {
      postUpdateEvent = function () {
        syncScrollToView()
        postUpdateEvent = null
      }
    }
  }
  lastDocHeight = editor.doc.height
})
editorInstance.on('focus', function (editor) {
  for (var i = 0; i < onlineUsers.length; i++) {
    if (onlineUsers[i].id === personalInfo.id) {
      onlineUsers[i].cursor = editor.getCursor()
    }
  }
  personalInfo.cursor = editor.getCursor()
  socket.emit('cursor focus', editor.getCursor())
})

const cursorActivity = _.debounce(cursorActivityInner, cursorActivityDebounce)

function cursorActivityInner (editor) {
  if (editorHasFocus() && !Visibility.hidden()) {
    for (var i = 0; i < onlineUsers.length; i++) {
      if (onlineUsers[i].id === personalInfo.id) {
        onlineUsers[i].cursor = editor.getCursor()
      }
    }
    personalInfo.cursor = editor.getCursor()
    socket.emit('cursor activity', editor.getCursor())
  }
}

editorInstance.on('cursorActivity', editorInstance.updateStatusBar)
editorInstance.on('cursorActivity', cursorActivity)

editorInstance.on('beforeSelectionChange', editorInstance.updateStatusBar)
editorInstance.on('beforeSelectionChange', function (doc, selections) {
  // check selection and whether the statusbar has added
  if (selections && editorInstance.statusSelection) {
    const selection = selections.ranges[0]

    const anchor = selection.anchor
    const head = selection.head
    const start = head.line <= anchor.line ? head : anchor
    const end = head.line >= anchor.line ? head : anchor
    const selectionCharCount = Math.abs(head.ch - anchor.ch)

    let selectionText = ' — Selected '

    // borrow from brackets EditorStatusBar.js
    if (start.line !== end.line) {
      var lines = end.line - start.line + 1
      if (end.ch === 0) {
        lines--
      }
      selectionText += lines + ' lines'
    } else if (selectionCharCount > 0) {
      selectionText += selectionCharCount + ' columns'
    }

    if (start.line !== end.line || selectionCharCount > 0) {
      editorInstance.statusSelection.text(selectionText)
    } else {
      editorInstance.statusSelection.text('')
    }
  }
})

editorInstance.on('blur', function (cm) {
  for (var i = 0; i < onlineUsers.length; i++) {
    if (onlineUsers[i].id === personalInfo.id) {
      onlineUsers[i].cursor = null
    }
  }
  personalInfo.cursor = null
  socket.emit('cursor blur')
})

function saveInfo () {
  var scrollbarStyle = editor.getOption('scrollbarStyle')
  var left = $(window).scrollLeft()
  var top = $(window).scrollTop()
  switch (appState.currentMode) {
    case modeType.edit:
      if (scrollbarStyle === 'native') {
        lastInfo.edit.scroll.left = left
        lastInfo.edit.scroll.top = top
      } else {
        lastInfo.edit.scroll = editor.getScrollInfo()
      }
      break
    case modeType.view:
      lastInfo.view.scroll.left = left
      lastInfo.view.scroll.top = top
      break
    case modeType.both:
      lastInfo.edit.scroll = editor.getScrollInfo()
      lastInfo.view.scroll.left = ui.area.view.scrollLeft()
      lastInfo.view.scroll.top = ui.area.view.scrollTop()
      break
  }
  lastInfo.edit.cursor = editor.getCursor()
  lastInfo.edit.selections = editor.listSelections()
  lastInfo.needRestore = true
}

function restoreInfo () {
  var scrollbarStyle = editor.getOption('scrollbarStyle')
  if (lastInfo.needRestore) {
    var line = lastInfo.edit.cursor.line
    var ch = lastInfo.edit.cursor.ch
    editor.setCursor(line, ch)
    editor.setSelections(lastInfo.edit.selections)
    switch (appState.currentMode) {
      case modeType.edit:
        if (scrollbarStyle === 'native') {
          $(window).scrollLeft(lastInfo.edit.scroll.left)
          $(window).scrollTop(lastInfo.edit.scroll.top)
        } else {
          const left = lastInfo.edit.scroll.left
          const top = lastInfo.edit.scroll.top
          editor.scrollIntoView()
          editor.scrollTo(left, top)
        }
        break
      case modeType.view:
        $(window).scrollLeft(lastInfo.view.scroll.left)
        $(window).scrollTop(lastInfo.view.scroll.top)
        break
      case modeType.both:
        const left = lastInfo.edit.scroll.left
        const top = lastInfo.edit.scroll.top
        editor.scrollIntoView()
        editor.scrollTo(left, top)
        ui.area.view.scrollLeft(lastInfo.view.scroll.left)
        ui.area.view.scrollTop(lastInfo.view.scroll.top)
        break
    }

    lastInfo.needRestore = false
  }
}

// view actions
function refreshView () {
  ui.area.markdown.html('')
  isDirty = true
  updateViewInner()
}

var updateView = _.debounce(function () {
  editor.operation(updateViewInner)
}, updateViewDebounce)

var lastResult = null
var postUpdateEvent = null

function updateViewInner () {
  if (appState.currentMode === modeType.edit || !isDirty) return
  var value = editor.getValue()
  var lastMeta = md.meta
  md.meta = {}
  delete md.metaError
  var rendered = md.render(value)
  if (md.meta.type && md.meta.type === 'slide') {
    var slideOptions = {
      separator: '^(\r\n?|\n)---(\r\n?|\n)$',
      verticalSeparator: '^(\r\n?|\n)----(\r\n?|\n)$'
    }
    var slides = window.RevealMarkdown.slidify(editor.getValue(), slideOptions)
    ui.area.markdown.html(slides)
    window.RevealMarkdown.initialize()
    // prevent XSS
    ui.area.markdown.html(preventXSS(ui.area.markdown.html()))
    ui.area.markdown.addClass('slides')
    appState.syncscroll = false
    checkSyncToggle()
  } else {
    if (lastMeta.type && lastMeta.type === 'slide') {
      refreshView()
      ui.area.markdown.removeClass('slides')
      appState.syncscroll = true
      checkSyncToggle()
    }
    // only render again when meta changed
    if (JSON.stringify(md.meta) !== JSON.stringify(lastMeta)) {
      parseMeta(md, ui.area.codemirror, ui.area.markdown, $('#ui-toc'), $('#ui-toc-affix'))
      rendered = md.render(value)
    }
    // prevent XSS
    rendered = preventXSS(rendered)
    var result = postProcess(rendered).children().toArray()
    partialUpdate(result, lastResult, ui.area.markdown.children().toArray())
    if (result && lastResult && result.length !== lastResult.length) { updateDataAttrs(result, ui.area.markdown.children().toArray()) }
    lastResult = $(result).clone()
  }
  removeDOMEvents(ui.area.markdown)
  finishView(ui.area.markdown)
  autoLinkify(ui.area.markdown)
  deduplicatedHeaderId(ui.area.markdown)
  renderTOC(ui.area.markdown)
  generateToc('ui-toc')
  generateToc('ui-toc-affix')
  autoLinkify(ui.area.markdown)
  generateScrollspy()
  updateScrollspy()
  smoothHashScroll()
  isDirty = false
  clearMap()
  // buildMap();
  updateTitleReminder()
  if (postUpdateEvent && typeof postUpdateEvent === 'function') { postUpdateEvent() }
}

var updateHistoryDebounce = 600

var updateHistory = _.debounce(updateHistoryInner, updateHistoryDebounce)

function updateHistoryInner () {
  writeHistory(renderFilename(ui.area.markdown), renderTags(ui.area.markdown))
}

function updateDataAttrs (src, des) {
  // sync data attr startline and endline
  for (var i = 0; i < src.length; i++) {
    copyAttribute(src[i], des[i], 'data-startline')
    copyAttribute(src[i], des[i], 'data-endline')
  }
}

function partialUpdate (src, tar, des) {
  if (!src || src.length === 0 || !tar || tar.length === 0 || !des || des.length === 0) {
    ui.area.markdown.html(src)
    return
  }
  if (src.length === tar.length) { // same length
    for (let i = 0; i < src.length; i++) {
      copyAttribute(src[i], des[i], 'data-startline')
      copyAttribute(src[i], des[i], 'data-endline')
      var rawSrc = cloneAndRemoveDataAttr(src[i])
      var rawTar = cloneAndRemoveDataAttr(tar[i])
      if (rawSrc.outerHTML !== rawTar.outerHTML) {
        // console.log(rawSrc);
        // console.log(rawTar);
        $(des[i]).replaceWith(src[i])
      }
    }
  } else { // diff length
    var start = 0
    // find diff start position
    for (let i = 0; i < tar.length; i++) {
      // copyAttribute(src[i], des[i], 'data-startline');
      // copyAttribute(src[i], des[i], 'data-endline');
      const rawSrc = cloneAndRemoveDataAttr(src[i])
      const rawTar = cloneAndRemoveDataAttr(tar[i])
      if (!rawSrc || !rawTar || rawSrc.outerHTML !== rawTar.outerHTML) {
        start = i
        break
      }
    }
    // find diff end position
    var srcEnd = 0
    var tarEnd = 0
    for (let i = 0; i < src.length; i++) {
      // copyAttribute(src[i], des[i], 'data-startline');
      // copyAttribute(src[i], des[i], 'data-endline');
      const rawSrc = cloneAndRemoveDataAttr(src[i])
      const rawTar = cloneAndRemoveDataAttr(tar[i])
      if (!rawSrc || !rawTar || rawSrc.outerHTML !== rawTar.outerHTML) {
        start = i
        break
      }
    }
    // tar end
    for (let i = 1; i <= tar.length + 1; i++) {
      const srcLength = src.length
      const tarLength = tar.length
      // copyAttribute(src[srcLength - i], des[srcLength - i], 'data-startline');
      // copyAttribute(src[srcLength - i], des[srcLength - i], 'data-endline');
      const rawSrc = cloneAndRemoveDataAttr(src[srcLength - i])
      const rawTar = cloneAndRemoveDataAttr(tar[tarLength - i])
      if (!rawSrc || !rawTar || rawSrc.outerHTML !== rawTar.outerHTML) {
        tarEnd = tar.length - i
        break
      }
    }
    // src end
    for (let i = 1; i <= src.length + 1; i++) {
      const srcLength = src.length
      const tarLength = tar.length
      // copyAttribute(src[srcLength - i], des[srcLength - i], 'data-startline');
      // copyAttribute(src[srcLength - i], des[srcLength - i], 'data-endline');
      const rawSrc = cloneAndRemoveDataAttr(src[srcLength - i])
      const rawTar = cloneAndRemoveDataAttr(tar[tarLength - i])
      if (!rawSrc || !rawTar || rawSrc.outerHTML !== rawTar.outerHTML) {
        srcEnd = src.length - i
        break
      }
    }
    // check if tar end overlap tar start
    var overlap = 0
    for (var i = start; i >= 0; i--) {
      var rawTarStart = cloneAndRemoveDataAttr(tar[i - 1])
      var rawTarEnd = cloneAndRemoveDataAttr(tar[tarEnd + 1 + start - i])
      if (rawTarStart && rawTarEnd && rawTarStart.outerHTML === rawTarEnd.outerHTML) { overlap++ } else { break }
    }
    if (debug) { console.log('overlap:' + overlap) }
    // show diff content
    if (debug) {
      console.log('start:' + start)
      console.log('tarEnd:' + tarEnd)
      console.log('srcEnd:' + srcEnd)
    }
    tarEnd += overlap
    srcEnd += overlap
    var repeatAdd = (start - srcEnd) < (start - tarEnd)
    var repeatDiff = Math.abs(srcEnd - tarEnd) - 1
    // push new elements
    var newElements = []
    if (srcEnd >= start) {
      for (let j = start; j <= srcEnd; j++) {
        if (!src[j]) continue
        newElements.push(src[j].outerHTML)
      }
    } else if (repeatAdd) {
      for (let j = srcEnd - repeatDiff; j <= srcEnd; j++) {
        if (!des[j]) continue
        newElements.push(des[j].outerHTML)
      }
    }
    // push remove elements
    var removeElements = []
    if (tarEnd >= start) {
      for (let j = start; j <= tarEnd; j++) {
        if (!des[j]) continue
        removeElements.push(des[j])
      }
    } else if (!repeatAdd) {
      for (let j = start; j <= start + repeatDiff; j++) {
        if (!des[j]) continue
        removeElements.push(des[j])
      }
    }
    // add elements
    if (debug) {
      console.log('ADD ELEMENTS')
      console.log(newElements.join('\n'))
    }
    if (des[start]) { $(newElements.join('')).insertBefore(des[start]) } else { $(newElements.join('')).insertAfter(des[start - 1]) }
    // remove elements
    if (debug) { console.log('REMOVE ELEMENTS') }
    for (let j = 0; j < removeElements.length; j++) {
      if (debug) {
        console.log(removeElements[j].outerHTML)
      }
      if (removeElements[j]) { $(removeElements[j]).remove() }
    }
  }
}

function cloneAndRemoveDataAttr (el) {
  if (!el) return
  var rawEl = $(el).clone()
  rawEl.removeAttr('data-startline data-endline')
  rawEl.find('[data-startline]').removeAttr('data-startline data-endline')
  return rawEl[0]
}

function copyAttribute (src, des, attr) {
  if (src && src.getAttribute(attr) && des) { des.setAttribute(attr, src.getAttribute(attr)) }
}

if ($('.cursor-menu').length <= 0) {
  $("<div class='cursor-menu'>").insertAfter('.CodeMirror-cursors')
}

function reverseSortCursorMenu (dropdown) {
  var items = dropdown.find('.textcomplete-item')
  items.sort(function (a, b) {
    return $(b).attr('data-index') - $(a).attr('data-index')
  })
  return items
}

var checkCursorMenu = _.throttle(checkCursorMenuInner, cursorMenuThrottle)

function checkCursorMenuInner () {
  // get element
  var dropdown = $('.cursor-menu > .dropdown-menu')
  // return if not exists
  if (dropdown.length <= 0) return
  // set margin
  var menuRightMargin = 10
  var menuBottomMargin = 4
  // use sizer to get the real doc size (won't count status bar and gutters)
  var docWidth = ui.area.codemirrorSizer.width()
  // get editor size (status bar not count in)
  var editorHeight = ui.area.codemirror.height()
  // get element size
  var width = dropdown.outerWidth()
  var height = dropdown.outerHeight()
  // get cursor
  var cursor = editor.getCursor()
  // set element cursor data
  if (!dropdown.hasClass('CodeMirror-other-cursor')) { dropdown.addClass('CodeMirror-other-cursor') }
  dropdown.attr('data-line', cursor.line)
  dropdown.attr('data-ch', cursor.ch)
  // get coord position
  var coord = editor.charCoords({
    line: cursor.line,
    ch: cursor.ch
  }, 'windows')
  var left = coord.left
  var top = coord.top
  // get doc top offset (to workaround with viewport)
  var docTopOffset = ui.area.codemirrorSizerInner.position().top
  // set offset
  var offsetLeft = 0
  var offsetTop = defaultTextHeight
  // set up side down
  window.upSideDown = false
  var lastUpSideDown = window.upSideDown = false
  // only do when have width and height
  if (width > 0 && height > 0) {
    // make element right bound not larger than doc width
    if (left + width + offsetLeft + menuRightMargin > docWidth) { offsetLeft = -(left + width - docWidth + menuRightMargin) }
    // flip y when element bottom bound larger than doc height
    // and element top position is larger than element height
    if (top + docTopOffset + height + offsetTop + menuBottomMargin > Math.max(editor.doc.height, editorHeight) && top + docTopOffset > height + menuBottomMargin) {
      offsetTop = -(height + menuBottomMargin)
      // reverse sort menu because upSideDown
      dropdown.html(reverseSortCursorMenu(dropdown))
      window.upSideDown = true
    }
    var textCompleteDropdown = $(editor.getInputField()).data('textComplete').dropdown
    lastUpSideDown = textCompleteDropdown.upSideDown
    textCompleteDropdown.upSideDown = window.upSideDown
  }
  // make menu scroll top only if upSideDown changed
  if (window.upSideDown !== lastUpSideDown) { dropdown.scrollTop(dropdown[0].scrollHeight) }
  // set element offset data
  dropdown.attr('data-offset-left', offsetLeft)
  dropdown.attr('data-offset-top', offsetTop)
  // set position
  dropdown[0].style.left = left + offsetLeft + 'px'
  dropdown[0].style.top = top + offsetTop + 'px'
}

function checkInIndentCode () {
  // if line starts with tab or four spaces is a code block
  var line = editor.getLine(editor.getCursor().line)
  var isIndentCode = ((line.substr(0, 4) === '    ') || (line.substr(0, 1) === '\t'))
  return isIndentCode
}

var isInCode = false

function checkInCode () {
  isInCode = checkAbove(matchInCode) || checkInIndentCode()
}

function checkAbove (method) {
  var cursor = editor.getCursor()
  var text = []
  for (var i = 0; i < cursor.line; i++) { // contain current line
    text.push(editor.getLine(i))
  }
  text = text.join('\n') + '\n' + editor.getLine(cursor.line).slice(0, cursor.ch)
  // console.log(text);
  return method(text)
}

function checkBelow (method) {
  var cursor = editor.getCursor()
  var count = editor.lineCount()
  var text = []
  for (var i = cursor.line + 1; i < count; i++) { // contain current line
    text.push(editor.getLine(i))
  }
  text = editor.getLine(cursor.line).slice(cursor.ch) + '\n' + text.join('\n')
  // console.log(text);
  return method(text)
}

function matchInCode (text) {
  var match
  match = text.match(/`{3,}/g)
  if (match && match.length % 2) {
    return true
  } else {
    match = text.match(/`/g)
    if (match && match.length % 2) {
      return true
    } else {
      return false
    }
  }
}

var isInContainer = false
var isInContainerSyntax = false

function checkInContainer () {
  isInContainer = checkAbove(matchInContainer) && !checkInIndentCode()
}

function checkInContainerSyntax () {
  // if line starts with :::, it's in container syntax
  var line = editor.getLine(editor.getCursor().line)
  isInContainerSyntax = (line.substr(0, 3) === ':::')
}

function matchInContainer (text) {
  var match
  match = text.match(/^:::/gm)
  if (match && match.length % 2) {
    return true
  } else {
    return false
  }
}

const textCompleteKeyMap = {
  Up: function () {
    return false
  },
  Right: function () {
    editor.doc.cm.execCommand('goCharRight')
  },
  Down: function () {
    return false
  },
  Left: function () {
    editor.doc.cm.execCommand('goCharLeft')
  },
  Enter: function () {
    return false
  },
  Backspace: function () {
    editor.doc.cm.execCommand('delCharBefore')
  }
}

$(editor.getInputField())
  .textcomplete([
    { // emoji strategy
      match: /(^|\n|\s)\B:([-+\w]*)$/,
      search: function (term, callback) {
        var line = editor.getLine(editor.getCursor().line)
        term = line.match(this.match)[2]
        var list = []
        $.map(window.emojify.emojiNames, function (emoji) {
          if (emoji.indexOf(term) === 0) { // match at first character
            list.push(emoji)
          }
        })
        $.map(window.emojify.emojiNames, function (emoji) {
          if (emoji.indexOf(term) !== -1) { // match inside the word
            list.push(emoji)
          }
        })
        callback(list)
      },
      template: function (value) {
        return `<img class="emoji" src="${emojifyImageDir}/${value}.png"></img> ${value}`
      },
      replace: function (value) {
        return '$1:' + value + ': '
      },
      index: 1,
      context: function (text) {
        checkInCode()
        checkInContainer()
        checkInContainerSyntax()
        return !isInCode && !isInContainerSyntax
      }
    },
    { // Code block language strategy
      langs: supportCodeModes,
      charts: supportCharts,
      match: /(^|\n)```(\w+)$/,
      search: function (term, callback) {
        var line = editor.getLine(editor.getCursor().line)
        term = line.match(this.match)[2]
        var list = []
        $.map(this.langs, function (lang) {
          if (lang.indexOf(term) === 0 && lang !== term) { list.push(lang) }
        })
        $.map(this.charts, function (chart) {
          if (chart.indexOf(term) === 0 && chart !== term) { list.push(chart) }
        })
        callback(list)
      },
      replace: function (lang) {
        var ending = ''
        if (!checkBelow(matchInCode)) {
          ending = '\n\n```'
        }
        if (this.langs.indexOf(lang) !== -1) { return '$1```' + lang + '=' + ending } else if (this.charts.indexOf(lang) !== -1) { return '$1```' + lang + ending }
      },
      done: function () {
        var cursor = editor.getCursor()
        var text = []
        text.push(editor.getLine(cursor.line - 1))
        text.push(editor.getLine(cursor.line))
        text = text.join('\n')
        // console.log(text);
        if (text === '\n```') { editor.doc.cm.execCommand('goLineUp') }
      },
      context: function (text) {
        return isInCode
      }
    },
    { // Container strategy
      containers: supportContainers,
      match: /(^|\n):::(\s*)(\w*)$/,
      search: function (term, callback) {
        var line = editor.getLine(editor.getCursor().line)
        term = line.match(this.match)[3].trim()
        var list = []
        $.map(this.containers, function (container) {
          if (container.indexOf(term) === 0 && container !== term) { list.push(container) }
        })
        callback(list)
      },
      replace: function (lang) {
        var ending = ''
        if (!checkBelow(matchInContainer)) {
          ending = '\n\n:::'
        }
        if (this.containers.indexOf(lang) !== -1) { return '$1:::$2' + lang + ending }
      },
      done: function () {
        var cursor = editor.getCursor()
        var text = []
        text.push(editor.getLine(cursor.line - 1))
        text.push(editor.getLine(cursor.line))
        text = text.join('\n')
        // console.log(text);
        if (text === '\n:::') { editor.doc.cm.execCommand('goLineUp') }
      },
      context: function (text) {
        return !isInCode && isInContainer
      }
    },
    { // header
      match: /(?:^|\n)(\s{0,3})(#{1,6}\w*)$/,
      search: function (term, callback) {
        callback($.map(supportHeaders, function (header) {
          return header.search.indexOf(term) === 0 ? header.text : null
        }))
      },
      replace: function (value) {
        return '$1' + value
      },
      context: function (text) {
        return !isInCode
      }
    },
    { // extra tags for list
      match: /(^[>\s]*[-+*]\s(?:\[[x ]\]|.*))(\[\])(\w*)$/,
      search: function (term, callback) {
        var list = []
        $.map(supportExtraTags, function (extratag) {
          if (extratag.search.indexOf(term) === 0) { list.push(extratag.command()) }
        })
        $.map(supportReferrals, function (referral) {
          if (referral.search.indexOf(term) === 0) { list.push(referral.text) }
        })
        callback(list)
      },
      replace: function (value) {
        return '$1' + value
      },
      context: function (text) {
        return !isInCode
      }
    },
    { // extra tags for blockquote
      match: /(?:^|\n|\s)(>.*|\s|)((\^|)\[(\^|)\](\[\]|\(\)|:|)\s*\w*)$/,
      search: function (term, callback) {
        var line = editor.getLine(editor.getCursor().line)
        var quote = line.match(this.match)[1].trim()
        var list = []
        if (quote.indexOf('>') === 0) {
          $.map(supportExtraTags, function (extratag) {
            if (extratag.search.indexOf(term) === 0) { list.push(extratag.command()) }
          })
        }
        $.map(supportReferrals, function (referral) {
          if (referral.search.indexOf(term) === 0) { list.push(referral.text) }
        })
        callback(list)
      },
      replace: function (value) {
        return '$1' + value
      },
      context: function (text) {
        return !isInCode
      }
    },
    { // referral
      match: /(^\s*|\n|\s{2})((\[\]|\[\]\[\]|\[\]\(\)|!|!\[\]|!\[\]\[\]|!\[\]\(\))\s*\w*)$/,
      search: function (term, callback) {
        callback($.map(supportReferrals, function (referral) {
          return referral.search.indexOf(term) === 0 ? referral.text : null
        }))
      },
      replace: function (value) {
        return '$1' + value
      },
      context: function (text) {
        return !isInCode
      }
    },
    { // externals
      match: /(^|\n|\s)\{\}(\w*)$/,
      search: function (term, callback) {
        callback($.map(supportExternals, function (external) {
          return external.search.indexOf(term) === 0 ? external.text : null
        }))
      },
      replace: function (value) {
        return '$1' + value
      },
      context: function (text) {
        return !isInCode
      }
    }
  ], {
    appendTo: $('.cursor-menu')
  })
  .on({
    'textComplete:beforeSearch': function (e) {
      // NA
    },
    'textComplete:afterSearch': function (e) {
      checkCursorMenu()
    },
    'textComplete:select': function (e, value, strategy) {
      // NA
    },
    'textComplete:show': function (e) {
      $(this).data('autocompleting', true)
      editor.addKeyMap(textCompleteKeyMap)
    },
    'textComplete:hide': function (e) {
      $(this).data('autocompleting', false)
      editor.removeKeyMap(textCompleteKeyMap)
    }
  })

// save revision
ui.toolbar.extra.saveRevision.click(function (e) {
  e.preventDefault()
  e.stopPropagation()
  
  console.log('==== Save Revision 按钮被点击 ====');
  
  // 在界面上显示一个临时提示
  var $notification = $('<div class="alert alert-info save-revision-notification" style="position:fixed; top:60px; right:20px; z-index:9999; padding:10px 15px;"><i class="fa fa-spinner fa-spin"></i> 正在保存修订版本...</div>');
  $('body').append($notification);
  
  // 显示保存中的提示
  showMessageModal(
    '保存修订版本',
    null,
    null,
    '正在保存修订版本...',
    true
  )
  
  // 调用API保存修订版本
  $.ajax({
    type: 'POST',
    url: serverurl + '/api/notes/' + noteid + '/revision',
    contentType: 'application/json',
    headers: {
      'X-Requested-With': 'XMLHttpRequest'
    },
    xhrFields: {
      withCredentials: true
    },
    beforeSend: function() {
      console.log('发送请求保存修订版本: ' + serverurl + '/api/notes/' + noteid + '/revision');
    },
    success: function (data) {
      console.log('保存修订版本成功:', data);
      
      // 更新通知为成功
      $notification.removeClass('alert-info').addClass('alert-success').html('<i class="fa fa-check"></i> 修订版本已成功保存');
      
      // 3秒后自动移除通知
      setTimeout(function() {
        $notification.fadeOut(function() {
          $(this).remove();
        });
      }, 3000);
      
      // 保存成功后显示成功消息
      showMessageModal(
        '保存修订版本',
        null,
        null,
        '修订版本已成功保存',
        true
      )
      
      // 立即刷新修订版本列表
      console.log('刷新修订版本列表...');
      $.get(noteurl + '/revision')
        .done(function (data) {
          console.log('收到修订版本数据:', data);
          // 重置revisions全局变量
          revisions = [];
          
          // 如果对话框已打开，更新UI
          if (ui.modal.revision.hasClass('in')) {
            parseRevisions(data.revision);
            
            // 选择最新的修订版本
            if (data.revision && data.revision.length > 0) {
              selectRevision(data.revision[0].time);
            }
          }
        })
        .fail(function (err) {
          console.error('刷新修订版本失败:', err);
        });
    },
    error: function (xhr, status, error) {
      console.error('保存修订版本错误:', status, error);
      console.error('详细错误信息:', xhr.responseText);
      
      // 更新通知为错误
      $notification.removeClass('alert-info').addClass('alert-danger').html('<i class="fa fa-times"></i> 保存修订版本失败');
      
      // 3秒后自动移除通知
      setTimeout(function() {
        $notification.fadeOut(function() {
          $(this).remove();
        });
      }, 3000);
      
      // 保存失败时显示错误消息
      var errorMsg = '';
      try {
        if (xhr.responseJSON && xhr.responseJSON.message) {
          errorMsg = xhr.responseJSON.message;
        } else if (xhr.responseText) {
          errorMsg = xhr.responseText;
        } else {
          errorMsg = error || '未知错误';
        }
      } catch (e) {
        errorMsg = '请求失败: ' + status;
      }
      
      showMessageModal(
        '保存修订版本',
        null,
        null,
        '保存修订版本失败: ' + errorMsg,
        false
      )
    }
  })
})

// 导入IDBManager类
import IDBManager from './lib/idb-manager.js'
// 创建IDB管理器实例
const idbManager = new IDBManager()

// 添加同步离线更改的函数
async function syncOfflineChanges() {
  try {
    // 获取当前笔记的最新内容
    const noteSnapshot = await idbManager.getNoteSnapshot(noteid);
    if (!noteSnapshot) {
      console.log('没有找到离线笔记内容');
      return;
    }
    
    // 获取待处理的操作队列
    const pendingOps = await idbManager.getPendingOperations(noteid);
    
    // 获取当前文档内容（以当前编辑器内容为准）
    const currentContent = editor.getValue();
    
    // 暂时禁用编辑，防止用户在同步时继续编辑
    editor.setOption('readOnly', true);
    
    try {
      if (pendingOps && pendingOps.length > 0) {
        console.log(`发现${pendingOps.length}个离线操作待同步`);
        
        // 首先尝试通过socket的方式同步
        try {
          console.log('尝试通过socket同步内容...');
          
          // 首先请求完整文档刷新
          await new Promise((resolve) => {
            // 请求刷新，获取当前服务器文档
            socket.emit('refresh');
            
            // 给服务器一点时间响应
            setTimeout(resolve, 1000);
          });
          
          if (cmClient) {
            // 重置客户端状态
            cmClient.serverReconnect();
          }
          
          // 等待一点时间让文档同步
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // 然后直接通过socket发送内容
          await new Promise((resolve, reject) => {
            let timeout = setTimeout(() => {
              // 超时不是致命错误，继续执行
              console.warn('等待socket响应超时，继续执行');
              resolve();
            }, 5000);
            
            // 监听服务器确认
            const ackHandler = function() {
              console.log('服务器已确认收到内容更新');
              clearTimeout(timeout);
              socket.off('ack', ackHandler);
              resolve();
            };
            
            socket.on('ack', ackHandler);
            
            // 使用socket.io直接发送内容替换操作
            socket.emit('operation', {
              op: [
                {p: 0, d: editor.getValue().length}, // 删除所有内容
                {p: 0, i: currentContent}            // 插入新内容
              ]
            });
            
            console.log('已发送完整内容更新');
          });
          
          console.log('Socket同步完成');
        } catch (socketError) {
          console.error('Socket同步失败:', socketError);
          
          // 如果socket方法失败，尝试备用方法
          console.log('尝试备用方法同步...');
          
          // 直接使用socket.emit('doc')请求新文档
          await new Promise((resolve) => {
            socket.emit('refresh');
            console.log('已请求文档刷新');
            setTimeout(resolve, 2000);
          });
          
          // 等待更新后，直接执行编辑器内容替换
          editor.setValue(currentContent);
          editor.clearHistory();
          
          // 设置更改来源为ignoreHistory以避免触发额外操作
          if (cmClient) {
            cmClient.editorAdapter.ignoreNextChange = true;
          }
          
          console.log('已通过直接替换方式更新内容');
        }
        
        // 将离线操作标记为已同步
        await idbManager.clearPendingOperations(noteid);
        
        // 再次请求服务器刷新
        socket.emit('refresh');
        
      } else {
        console.log('没有离线操作需要同步');
        
        // 恢复链接状态但没有新操作，检查服务器内容与本地内容是否一致
        // 如果编辑器内容与上次保存到服务器的内容不同，也应该同步
        if (noteSnapshot.metadata && noteSnapshot.metadata.serverContent !== currentContent) {
          console.log('本地内容与服务器内容不同，同步更新');
          
          if (cmClient) {
            // 重置客户端状态
            cmClient.serverReconnect();
            
            // 要求服务器刷新，获取最新版本
            socket.emit('refresh');
          }
        }
      }
      
      return true;
    } catch (err) {
      console.error('同步过程中发生错误:', err);
      // 即使同步失败，也尝试恢复正常状态
      socket.emit('refresh');
      throw err;
    } finally {
      // 完成后重新启用编辑
      editor.setOption('readOnly', false);
    }
  } catch (err) {
    console.error('同步离线更改时出错:', err);
    // 确保编辑器可用
    editor.setOption('readOnly', false);
    throw err;
  }
}

// 添加网络状态监听器，确保在任何情况下网络离线时都设置离线模式
window.addEventListener('offline', function() {
  console.log('网络已离线，确保离线编辑模式');
  
  // 设置离线模式
  isOfflineMode = true;
  
  // 确保编辑器可编辑
  if (editor.getOption('readOnly')) {
    editor.setOption('readOnly', false);
    console.log('已解除编辑器只读状态');
  }
  
  // 显示离线状态
  showStatus(statusType.offline);
  
  // 更新离线指示器
  updateOfflineIndicator(true);
  
  // 显示通知
  showTemporaryNotification('<i class="fa fa-exclamation-triangle"></i> 网络已断开，进入离线编辑模式', 'warning');
  
  // 保存当前状态到IndexedDB
  const content = editor.getValue();
  if (noteid && content) {
    idbManager.saveNoteSnapshot(noteid, content)
      .then(() => console.log('离线状态已保存笔记内容'))
      .catch(err => console.error('保存笔记失败:', err));
  }
});

// 添加网络online事件的处理
window.addEventListener('online', function() {
  console.log('网络已恢复');
  
  // 如果当前是离线编辑模式，尝试自动重连
  if (isOfflineMode) {
    // 显示正在连接的状态
    showStatus(statusType.connected);
    
    // 显示通知
    showTemporaryNotification('<i class="fa fa-wifi"></i> 网络已恢复，正在重新连接...', 'info');
    
    // 如果socket已断开，尝试重连
    if (!socket.connected) {
      socket.connect();
    }
    
    // 添加定时器检查连接状态
    setTimeout(function() {
      if (socket.connected) {
        console.log('成功重新连接到服务器');
        
        // 更新UI状态
        showStatus(statusType.online, onlineUsers.length);
        
        // 同步离线更改
        syncOfflineChanges().then(() => {
          // 再次强制刷新确保同步成功
          return forceRefreshDocument();
        }).then(() => {
          // 同步完成
          showTemporaryNotification('<i class="fa fa-check"></i> 所有更改已同步', 'success');
          
          // 更新为非离线模式
          isOfflineMode = false;
          
          // 移除离线指示器
          updateOfflineIndicator(false);
        }).catch(err => {
          console.error('同步离线更改失败:', err);
          
          // 即使同步失败，也要继续正常操作
          showTemporaryNotification('<i class="fa fa-exclamation-triangle"></i> 同步部分更改失败，但您可以继续编辑', 'warning');
          
          // 确保显示为在线状态
          showStatus(statusType.online, onlineUsers.length);
          
          // 移除离线指示器
          updateOfflineIndicator(false);
          
          // 恢复正常状态
          isOfflineMode = false;
          
          // 确保可以继续编辑
          if (editor.getOption('readOnly')) {
            editor.setOption('readOnly', false);
          }
        });
      }
    }, 2000);
  }
});

// 在文档加载完成时运行
$(document).ready(function() {
  // ... 现有代码
})

// 添加调试函数，可以在console直接调用启用离线编辑
window.forceOfflineEditing = function() {
  console.log('强制启用离线编辑模式');
  
  // 设置离线模式
  isOfflineMode = true;
  
  // 确保编辑器可编辑
  if (editor.getOption('readOnly')) {
    editor.setOption('readOnly', false);
    console.log('已解除编辑器只读状态');
  }
  
  // 显示离线状态
  showStatus(statusType.offline);
  
  // 更新离线指示器
  updateOfflineIndicator(true);
  
  // 显示通知
  showTemporaryNotification('<i class="fa fa-exclamation-triangle"></i> 已强制启用离线编辑模式', 'warning');
  
  return "离线编辑模式已启用";
};

// 可调用此函数检查当前离线状态
window.checkOfflineStatus = function() {
  console.log({
    isOfflineMode: isOfflineMode,
    editorReadOnly: editor.getOption('readOnly'),
    networkOnline: navigator.onLine,
    socketConnected: socket.connected
  });
  
  return {
    isOfflineMode: isOfflineMode,
    editorReadOnly: editor.getOption('readOnly'),
    networkOnline: navigator.onLine,
    socketConnected: socket.connected
  };
};

// 添加一个强制刷新文档的函数
function forceRefreshDocument() {
  return new Promise((resolve, reject) => {
    console.log('请求文档强制刷新...');
    
    // 设置超时保护
    const timeout = setTimeout(() => {
      console.warn('文档刷新超时');
      resolve(false);
    }, 5000);
    
    // 临时事件处理器
    const docHandler = function(doc) {
      console.log('接收到文档更新');
      clearTimeout(timeout);
      socket.off('doc', docHandler);
      resolve(true);
    };
    
    // 监听doc事件
    socket.on('doc', docHandler);
    
    // 发送refresh请求
    socket.emit('refresh');
  });
}
