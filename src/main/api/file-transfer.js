import axios from 'axios'
import FormData from 'form-data'
import fs from 'fs'
import path from 'path'
import { serviceUrl } from '../config/config.js'
import log from '../logger.js'

/**
 * Upload a file to the backend server
 * @param {string} filePath - Local file path
 * @param {string} service - Service name ('tts', 'face2face')
 * @param {string} category - File category ('audio', 'video', etc.)
 * @returns {Promise<{success: boolean, remotePath: string, error: string}>}
 */
export async function uploadFile(filePath, service, category) {
  try {
    const formData = new FormData()
    formData.append('file', fs.createReadStream(filePath))
    formData.append('category', category)
    
    const fileName = path.basename(filePath)
    
    const response = await axios.post(
      `${serviceUrl[service]}/file/upload`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    )
    
    log.debug('~ uploadFile ~ response:', response.data)
    
    if (response.data.success) {
      return {
        success: true,
        remotePath: response.data.filePath,
        fileName: fileName
      }
    } else {
      return {
        success: false,
        error: response.data.error || 'Unknown error'
      }
    }
  } catch (error) {
    log.error('~ uploadFile ~ error:', error.message)
    return {
      success: false,
      error: error.message
    }
  }
}

/**
 * Download a file from the backend server
 * @param {string} remotePath - Remote file path
 * @param {string} localPath - Local destination path
 * @param {string} service - Service name ('tts', 'face2face')
 * @returns {Promise<{success: boolean, localPath: string, error: string}>}
 */
export async function downloadFile(remotePath, localPath, service) {
  try {
    const response = await axios.get(
      `${serviceUrl[service]}/file/download`,
      {
        params: { path: remotePath },
        responseType: 'arraybuffer'
      }
    )
    
    fs.writeFileSync(localPath, response.data)
    
    return {
      success: true,
      localPath
    }
  } catch (error) {
    log.error('~ downloadFile ~ error:', error.message)
    return {
      success: false,
      error: error.message
    }
  }
}
