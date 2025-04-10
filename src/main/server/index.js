import { createFileServer } from './file-server.js'
import { fileServer } from '../config/config.js'
import log from '../logger.js'
import fs from 'fs'

/**
 * Initialize file servers for each service
 */
export function initFileServers() {
  // Create directories if they don't exist
  Object.values(fileServer).forEach(config => {
    if (!fs.existsSync(config.tempDir)) {
      fs.mkdirSync(config.tempDir, { recursive: true })
      log.info(`Created directory: ${config.tempDir}`)
    }
  })
  
  // Start file servers
  try {
    // Face2Face file server
    createFileServer(
      fileServer.face2face.port,
      fileServer.face2face.tempDir
    )
    log.info(`Face2Face file server started on port ${fileServer.face2face.port}`)
    
    // TTS file server
    createFileServer(
      fileServer.tts.port,
      fileServer.tts.tempDir
    )
    log.info(`TTS file server started on port ${fileServer.tts.port}`)
  } catch (error) {
    log.error('Failed to start file servers:', error.message)
  }
}
