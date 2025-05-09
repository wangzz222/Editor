'use strict'

const config = require('../config')
const logger = require('../logger')
const { Note, User, Revision } = require('../models')

const { newCheckViewPermission, errorForbidden, responseCodiMD, errorNotFound, errorInternalError } = require('../response')
const { updateHistory, historyDelete } = require('../history')
const { actionPublish, actionSlide, actionInfo, actionDownload, actionPDF, actionGist, actionRevision, actionPandoc } = require('./noteActions')
const realtime = require('../realtime/realtime')

async function getNoteById (noteId, { includeUser } = { includeUser: false }) {
  const id = await Note.parseNoteIdAsync(noteId)

  const includes = []

  if (includeUser) {
    includes.push({
      model: User,
      as: 'owner'
    }, {
      model: User,
      as: 'lastchangeuser'
    })
  }

  const note = await Note.findOne({
    where: {
      id: id
    },
    include: includes
  })
  return note
}

async function createNote (userId, noteAlias) {
  if (!config.allowAnonymous && !userId) {
    throw new Error('can not create note')
  }

  const note = await Note.create({
    ownerId: userId,
    alias: noteAlias
  })

  if (userId) {
    updateHistory(userId, note)
  }

  return note
}

// controller
async function showNote (req, res) {
  const noteId = req.params.noteId
  const userId = req.user ? req.user.id : null

  let note = await getNoteById(noteId)

  if (!note) {
    // if allow free url enable, auto create note
    if (!config.allowFreeURL || config.forbiddenNoteIDs.includes(noteId)) {
      return errorNotFound(req, res)
    } else if (!config.allowAnonymous && !userId) {
      return errorForbidden(req, res)
    }
    note = await createNote(userId, noteId)
  }

  if (!newCheckViewPermission(note, req.isAuthenticated(), userId)) {
    return errorForbidden(req, res)
  }

  // force to use note id
  const id = Note.encodeNoteId(note.id)
  if ((note.alias && noteId !== note.alias) || (!note.alias && noteId !== id)) {
    return res.redirect(config.serverURL + '/' + (note.alias || id))
  }
  return responseCodiMD(res, note)
}

function canViewNote (note, isLogin, userId) {
  if (note.permission === 'private') {
    return note.ownerId === userId
  }
  if (note.permission === 'limited' || note.permission === 'protected') {
    return isLogin
  }
  return true
}

async function showPublishNote (req, res) {
  const shortid = req.params.shortid

  const note = await getNoteById(shortid, {
    includeUser: true
  })

  if (!note) {
    return errorNotFound(req, res)
  }

  if (!canViewNote(note, req.isAuthenticated(), req.user ? req.user.id : null)) {
    return errorForbidden(req, res)
  }

  if ((note.alias && shortid !== note.alias) || (!note.alias && shortid !== note.shortid)) {
    return res.redirect(config.serverURL + '/s/' + (note.alias || note.shortid))
  }

  await note.increment('viewcount')

  const body = note.content
  const extracted = Note.extractMeta(body)
  const markdown = extracted.markdown
  const meta = Note.parseMeta(extracted.meta)
  const createTime = note.createdAt
  const updateTime = note.lastchangeAt
  const title = Note.generateWebTitle(meta.title || Note.decodeTitle(note.title))

  const data = {
    title: title,
    description: meta.description || (markdown ? Note.generateDescription(markdown) : null),
    image: meta.image,
    viewcount: note.viewcount,
    createtime: createTime,
    updatetime: updateTime,
    body: body,
    owner: note.owner ? note.owner.id : null,
    ownerprofile: note.owner ? User.getProfile(note.owner) : null,
    lastchangeuser: note.lastchangeuser ? note.lastchangeuser.id : null,
    lastchangeuserprofile: note.lastchangeuser ? User.getProfile(note.lastchangeuser) : null,
    robots: meta.robots || false, // default allow robots
    GA: meta.GA,
    disqus: meta.disqus,
    cspNonce: res.locals.nonce
  }

  res.set({
    'Cache-Control': 'private' // only cache by client
  })

  res.render('pretty.ejs', data)
}

async function noteActions (req, res) {
  const noteId = req.params.noteId

  const note = await getNoteById(noteId)

  if (!note) {
    return errorNotFound(req, res)
  }

  if (!canViewNote(note, req.isAuthenticated(), req.user ? req.user.id : null)) {
    return errorForbidden(req, res)
  }

  const action = req.params.action
  switch (action) {
    case 'publish':
    case 'pretty': // pretty deprecated
      return actionPublish(req, res, note)
    case 'slide':
      return actionSlide(req, res, note)
    case 'download':
      actionDownload(req, res, note)
      break
    case 'info':
      actionInfo(req, res, note)
      break
    case 'pdf':
      if (config.allowPDFExport) {
        actionPDF(req, res, note)
      } else {
        logger.error('PDF export failed: Disabled by config. Set "allowPDFExport: true" to enable. Check the documentation for details')
        errorForbidden(req, res)
      }
      break
    case 'gist':
      actionGist(req, res, note)
      break
    case 'revision':
      actionRevision(req, res, note)
      break
    case 'pandoc':
      actionPandoc(req, res, note)
      break
    default:
      return res.redirect(config.serverURL + '/' + noteId)
  }
}

async function getMyNoteList (userId, callback) {
  const myNotes = await Note.findAll({
    where: {
      ownerId: userId
    }
  })
  if (!myNotes) {
    return callback(null, null)
  }
  try {
    const myNoteList = myNotes.map(note => ({
      id: Note.encodeNoteId(note.id),
      text: note.title,
      tags: Note.parseNoteInfo(note.content).tags,
      createdAt: note.createdAt,
      lastchangeAt: note.lastchangeAt,
      shortId: note.shortid
    }))
    if (config.debug) {
      logger.info('Parse myNoteList success: ' + userId)
    }
    return callback(null, myNoteList)
  } catch (err) {
    logger.error('Parse myNoteList failed')
    return callback(err, null)
  }
}

function listMyNotes (req, res) {
  if (req.isAuthenticated()) {
    getMyNoteList(req.user.id, (err, myNoteList) => {
      if (err) return errorInternalError(req, res)
      if (!myNoteList) return errorNotFound(req, res)
      res.send({
        myNotes: myNoteList
      })
    })
  } else {
    return errorForbidden(req, res)
  }
}

const deleteNote = async (req, res) => {
  if (req.isAuthenticated()) {
    const noteId = await Note.parseNoteIdAsync(req.params.noteId)
    try {
      const destroyed = await Note.destroy({
        where: {
          id: noteId,
          ownerId: req.user.id
        }
      })
      if (!destroyed) {
        logger.error('Delete note failed: Make sure the noteId and ownerId are correct.')
        return errorNotFound(req, res)
      }

      historyDelete(req, res)

      if (realtime.isNoteExistsInPool(noteId)) {
        const note = realtime.getNoteFromNotePool(noteId)
        realtime.disconnectSocketOnNote(note)
      }

      res.send({
        status: 'ok'
      })
    } catch (err) {
      logger.error('Delete note failed: Internal Error.')
      return errorInternalError(req, res)
    }
  } else {
    return errorForbidden(req, res)
  }
}

const updateNote = async (req, res) => {
  const noteId = req.params.noteId
  const userId = req.user.id
  const content = req.body.content

  try {
    const id = await Note.parseNoteIdAsync(noteId)
    const note = await Note.findOne({
      where: {
        id
      }
    })

    if (!note) return errorNotFound(req, res)

    if (userId !== note.ownerId) {
      return errorForbidden(req, res)
    }

    if (!content) {
      return errorInternalError(req, res)
    }

    await note.update({
      title: Note.parseNoteTitle(content),
      content,
      lastchangeAt: Date.now(),
      lastchangeuserId: userId
    })

    return res.send({
      id
    })
  } catch (err) {
    logger.error('Update note failed: ' + err)
    return errorInternalError(req, res)
  }
}

// 手动保存指定笔记的修订版本
const saveNoteRevision = async (req, res) => {
  const noteId = req.params.noteId
  logger.info('Manual save note revision request received for noteId: ' + noteId)
  
  // 检查是否已经登录
  if (!req.isAuthenticated()) {
    logger.warn('Manual save note revision failed: User not authenticated')
    return errorForbidden(req, res)
  }
  
  const userId = req.user.id
  logger.info('Manual save note revision user: ' + userId)

  try {
    const id = await Note.parseNoteIdAsync(noteId)
    logger.info('Manual save note revision parsed id: ' + id)
    
    const note = await Note.findOne({
      where: {
        id
      }
    })

    if (!note) {
      logger.warn('Manual save note revision failed: Note not found with id: ' + id)
      return errorNotFound(req, res)
    }

    // 检查权限 - 只有笔记所有者可以手动保存修订版本
    if (userId !== note.ownerId) {
      logger.warn('Manual save note revision failed: Permission denied. UserId: ' + userId + ', OwnerId: ' + note.ownerId)
      return errorForbidden(req, res)
    }

    logger.info('Manual save note revision: Saving revision for note ' + id)
    // 使用 saveRevisionJob 保存修订版本
    const revision = await realtime.saveRevisionJob.saveNoteRevision(id)
    logger.info('Manual save note revision success for note ' + id)
    
    return res.status(200).json({
      status: 'ok',
      noteId: id,
      message: '笔记修订版本已保存'
    })
  } catch (err) {
    logger.error('Manual save note revision failed: ' + err.message, err.stack)
    return errorInternalError(req, res)
  }
}

// 手动保存所有笔记的修订版本 (仅管理员可用)
const saveAllNotesRevisions = async (req, res) => {
  const userId = req.user ? req.user.id : null

  // 检查是否有权限保存
  if (!userId) {
    return errorForbidden(req, res)
  }

  try {
    // 检查是否是管理员
    const user = await User.findOne({
      where: {
        id: userId
      }
    })

    if (!user || !config.isSuperUser(user.email)) {
      return errorForbidden(req, res)
    }

    // 使用 saveRevisionJob 保存所有笔记的修订版本
    const notes = await realtime.saveRevisionJob.saveAllRevisions()

    return res.status(200).json({
      status: 'ok',
      count: notes ? notes.length : 0,
      message: '所有笔记的修订版本已保存'
    })
  } catch (err) {
    logger.error('Manual save all notes revisions failed: ' + err)
    return errorInternalError(req, res)
  }
}

module.exports = {
  showNote,
  showPublishNote,
  noteActions,
  listMyNotes,
  deleteNote,
  updateNote,
  saveNoteRevision,
  saveAllNotesRevisions
}
