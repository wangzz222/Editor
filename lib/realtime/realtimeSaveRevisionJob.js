'use strict'

const models = require('../models')
const logger = require('../logger')

/**
 * clean when user not in any rooms or user not in connected list
 */
class SaveRevisionJob {
  constructor (realtime) {
    this.realtime = realtime
    this.saverSleep = false
  }

  start () {
    if (this.timer) return
    this.timer = setInterval(this.saveRevision.bind(this), 5 * 60 * 1000)
  }

  stop () {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  saveRevision () {
    if (this.getSaverSleep()) return
    models.Revision.saveAllNotesRevision((err, notes) => {
      if (err) return logger.error('revision saver failed: ' + err)
      if (notes && notes.length <= 0) {
        this.setSaverSleep(true)
      }
    })
  }

  // 手动保存指定笔记的快照
  saveNoteRevision (noteId) {
    logger.info(`Starting manual save note revision for noteId: ${noteId}`)
    return new Promise((resolve, reject) => {
      // 先获取Note对象
      models.Note.findOne({
        where: {
          id: noteId
        }
      }).then(note => {
        if (!note) {
          const err = new Error(`Note not found with id: ${noteId}`)
          logger.error(err.message)
          return reject(err)
        }
        
        logger.info(`Found note for revision: ${noteId}, title: ${note.title}`)
        
        // 然后调用Revision.saveNoteRevision保存该笔记的修订版本
        models.Revision.saveNoteRevision(note, (err, revision) => {
          if (err) {
            logger.error(`Manual revision save failed for note ${noteId}: ${err}`)
            return reject(err)
          }
          logger.info(`Successfully saved revision for note ${noteId}, revision id: ${revision.id}`)
          resolve(revision)
        })
      }).catch(err => {
        logger.error(`Manual revision save failed when finding note ${noteId}: ${err}`)
        reject(err)
      })
    })
  }

  // 手动保存所有笔记的快照
  saveAllRevisions () {
    return new Promise((resolve, reject) => {
      models.Revision.saveAllNotesRevision((err, notes) => {
        if (err) {
          logger.error('manual revision save all failed: ' + err)
          return reject(err)
        }
        resolve(notes)
      })
    })
  }

  getSaverSleep () {
    return this.saverSleep
  }

  setSaverSleep (val) {
    this.saverSleep = val
  }
}

exports.SaveRevisionJob = SaveRevisionJob
