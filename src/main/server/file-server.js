import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { v4 as uuidv4 } from 'uuid'
import log from '../logger.js'

/**
 * Create a file server for handling file uploads and downloads
 * @param {number} port - Port to listen on
 * @param {string} tempDir - Directory to store temporary files
 * @returns {express.Application} Express application
 */
export function createFileServer(port, tempDir) {
  const app = express()
  
  // Create temp directory if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }
  
  // Configure multer for file uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const category = req.body.category || 'default'
      const categoryDir = path.join(tempDir, category)
      
      if (!fs.existsSync(categoryDir)) {
        fs.mkdirSync(categoryDir, { recursive: true })
      }
      
      cb(null, categoryDir)
    },
    filename: (req, file, cb) => {
      // Generate a unique filename to avoid collisions
      const uniqueFilename = `${uuidv4()}${path.extname(file.originalname)}`
      cb(null, uniqueFilename)
    }
  })
  
  const upload = multer({ storage })
  
  // File upload endpoint
  app.post('/file/upload', upload.single('file'), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded'
        })
      }
      
      const category = req.body.category || 'default'
      const relativePath = path.join(category, req.file.filename)
      
      log.debug('~ File uploaded:', relativePath)
      
      return res.json({
        success: true,
        filePath: relativePath,
        originalName: req.file.originalname
      })
    } catch (error) {
      log.error('~ File upload error:', error.message)
      return res.status(500).json({
        success: false,
        error: error.message
      })
    }
  })
  
  // File download endpoint
  app.get('/file/download', (req, res) => {
    try {
      const filePath = req.query.path
      
      if (!filePath) {
        return res.status(400).json({
          success: false,
          error: 'No file path provided'
        })
      }
      
      const fullPath = path.join(tempDir, filePath)
      
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({
          success: false,
          error: 'File not found'
        })
      }
      
      return res.download(fullPath)
    } catch (error) {
      log.error('~ File download error:', error.message)
      return res.status(500).json({
        success: false,
        error: error.message
      })
    }
  })
  
  // Start the server
  app.listen(port, () => {
    log.info(`File server listening on port ${port}`)
  })
  
  return app
}
