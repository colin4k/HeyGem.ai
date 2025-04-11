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

  // Add middleware to log all requests
  app.use((req, res, next) => {
    log.info(`${req.method} ${req.url}`)
    next()
  })

  // Add CORS middleware
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
    next()
  })

  // Create temp directory if it doesn't exist
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
    log.info(`Created temp directory: ${tempDir}`)
  } else {
    log.info(`Using existing temp directory: ${tempDir}`)
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
      log.info('File upload request received')
      log.info('Request body:', req.body)

      if (!req.file) {
        log.error('No file in request')
        return res.status(400).json({
          success: false,
          error: 'No file uploaded'
        })
      }

      log.info('File received:', req.file.originalname, 'Size:', req.file.size)

      const category = req.body.category || 'default'
      const relativePath = path.join(category, req.file.filename)

      log.info('File saved to:', path.join(tempDir, relativePath))

      const response = {
        success: true,
        filePath: relativePath,
        originalName: req.file.originalname
      }

      log.info('Sending response:', response)
      return res.json(response)
    } catch (error) {
      log.error('File upload error:', error)
      return res.status(500).json({
        success: false,
        error: error.message || 'Unknown error'
      })
    }
  })

  // File download endpoint
  app.get('/file/download', (req, res) => {
    try {
      log.info('File download request received')
      log.info('Request query:', req.query)

      const filePath = req.query.path

      if (!filePath) {
        log.error('No file path provided in request')
        return res.status(400).json({
          success: false,
          error: 'No file path provided'
        })
      }

      log.info(`Requested file path: ${filePath}`)

      // Normalize the path to prevent directory traversal attacks
      const normalizedPath = path.normalize(filePath).replace(/^\.\.\//, '')
      log.info(`Normalized path: ${normalizedPath}`)

      // Check if the path contains a category
      const pathParts = normalizedPath.split('/')
      log.info(`Path parts:`, pathParts)

      // If the path doesn't have a category, try to infer it
      let adjustedPath = normalizedPath

      // List all files in the temp directory to help with debugging
      log.info('Listing all directories in temp directory:')
      try {
        if (fs.existsSync(tempDir)) {
          const dirs = fs.readdirSync(tempDir)
          log.info(`Directories in ${tempDir}:`, dirs)

          // List files in each directory
          for (const dir of dirs) {
            const dirPath = path.join(tempDir, dir)
            if (fs.statSync(dirPath).isDirectory()) {
              try {
                const files = fs.readdirSync(dirPath)
                log.info(`Files in ${dirPath}:`, files.slice(0, 10), files.length > 10 ? `... and ${files.length - 10} more` : '')
              } catch (e) {
                log.error(`Error listing directory ${dirPath}:`, e.message)
              }
            }
          }
        } else {
          log.info(`Temp directory ${tempDir} does not exist`)
        }
      } catch (e) {
        log.error(`Error listing temp directory:`, e.message)
      }

      if (pathParts.length === 1) {
        // This is just a filename, try to find it in common categories
        const commonCategories = ['audio', 'model', 'origin_audio', 'temp', 'default']
        let found = false

        for (const category of commonCategories) {
          const testPath = path.join(tempDir, category, normalizedPath)
          log.info(`Trying path: ${testPath}`)

          if (fs.existsSync(testPath)) {
            adjustedPath = path.join(category, normalizedPath)
            log.info(`Found file in category '${category}'. Adjusted path: ${adjustedPath}`)
            found = true
            break
          }
        }

        if (!found) {
          // Try a recursive search for the file
          log.info(`Could not find file in common categories. Trying recursive search...`)
          try {
            const findFile = (dir, filename) => {
              const files = fs.readdirSync(dir)
              for (const file of files) {
                const filePath = path.join(dir, file)
                const stat = fs.statSync(filePath)
                if (stat.isDirectory()) {
                  const result = findFile(filePath, filename)
                  if (result) return result
                } else if (file === filename) {
                  return filePath
                }
              }
              return null
            }

            const foundPath = findFile(tempDir, normalizedPath)
            if (foundPath) {
              adjustedPath = path.relative(tempDir, foundPath)
              log.info(`Found file through recursive search: ${foundPath}`)
              log.info(`Adjusted path: ${adjustedPath}`)
              found = true
            } else {
              log.info(`File not found in recursive search`)
            }
          } catch (e) {
            log.error(`Error during recursive search:`, e.message)
          }
        }
      }

      const fullPath = path.join(tempDir, adjustedPath)
      log.info(`Full path: ${fullPath}`)

      // Check if the file exists
      if (!fs.existsSync(fullPath)) {
        log.error(`File not found: ${fullPath}`)

        // List files in the directory to help debug
        try {
          const dir = path.dirname(fullPath)
          if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir)
            log.info(`Files in directory ${dir}:`, files)
          } else {
            log.info(`Directory does not exist: ${dir}`)
          }
        } catch (e) {
          log.error('Error listing directory:', e.message)
        }

        return res.status(404).json({
          success: false,
          error: 'File not found'
        })
      }

      log.info(`Sending file: ${fullPath}`)
      return res.download(fullPath)
    } catch (error) {
      log.error('File download error:', error)
      return res.status(500).json({
        success: false,
        error: error.message || 'Unknown error'
      })
    }
  })

  // Start the server
  app.listen(port, () => {
    log.info(`File server listening on port ${port}`)
  })

  return app
}
