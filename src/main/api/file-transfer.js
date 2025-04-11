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
    log.info(`Uploading file ${filePath} to ${service} in category ${category}`)

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      log.error(`File does not exist: ${filePath}`)
      return {
        success: false,
        error: `File does not exist: ${filePath}`
      }
    }

    // Get file stats
    const stats = fs.statSync(filePath)
    log.info(`File size: ${stats.size} bytes`)

    // Create form data
    const formData = new FormData()
    formData.append('file', fs.createReadStream(filePath))
    formData.append('category', category)

    const fileName = path.basename(filePath)
    log.info(`File name: ${fileName}`)

    // Get service URL
    const url = `${serviceUrl[service]}/file/upload`
    log.info(`Uploading to URL: ${url}`)

    // Make request
    log.info('Sending request...')
    const response = await axios.post(
      url,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    )

    log.info('Response received:', response.status, response.statusText)
    log.info('Response data:', response.data)

    if (response.data.success) {
      log.info(`File uploaded successfully. Remote path: ${response.data.filePath}`)
      return {
        success: true,
        remotePath: response.data.filePath,
        fileName: fileName
      }
    } else {
      log.error(`Upload failed: ${response.data.error || 'Unknown error'}`)
      return {
        success: false,
        error: response.data.error || 'Unknown error'
      }
    }
  } catch (error) {
    log.error('Upload error:', error)
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      log.error('Response status:', error.response.status)
      log.error('Response headers:', error.response.headers)
      log.error('Response data:', error.response.data)
    } else if (error.request) {
      // The request was made but no response was received
      log.error('No response received. Request:', error.request)
    } else {
      // Something happened in setting up the request that triggered an Error
      log.error('Error setting up request:', error.message)
    }

    return {
      success: false,
      error: error.message || 'Unknown error'
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
    log.info(`Downloading file from ${service}. Remote path: ${remotePath}, Local path: ${localPath}`)

    // Check if remotePath is valid
    if (!remotePath) {
      log.error('Remote path is empty or undefined')
      return {
        success: false,
        error: 'Remote path is empty or undefined'
      }
    }

    // Create directory for local path if it doesn't exist
    const localDir = path.dirname(localPath)
    if (!fs.existsSync(localDir)) {
      log.info(`Creating directory: ${localDir}`)
      fs.mkdirSync(localDir, { recursive: true })
    }

    // Get service URL
    const serviceKey = `${service}FileServer`
    if (!serviceUrl[serviceKey]) {
      log.error(`Invalid service: ${service}. Available services: ${Object.keys(serviceUrl).join(', ')}`)
      return {
        success: false,
        error: `Invalid service: ${service}`
      }
    }

    const url = `${serviceUrl[serviceKey]}/file/download`
    log.info(`Download URL: ${url}?path=${encodeURIComponent(remotePath)}`)

    // Try different path formats if the original fails
    const pathVariations = [
      remotePath,
      remotePath.replace(/\\/g, '/'),
      path.basename(remotePath)
    ]

    let response = null
    let error = null

    // Try each path variation
    for (const pathVar of pathVariations) {
      try {
        log.info(`Trying path variation: ${pathVar}`)
        response = await axios.get(
          url,
          {
            params: { path: pathVar },
            responseType: 'arraybuffer'
          }
        )

        // If successful, break the loop
        log.info(`Download successful with path: ${pathVar}`)
        break
      } catch (err) {
        log.warn(`Failed with path ${pathVar}: ${err.message}`)
        error = err
      }
    }

    // If all variations failed, throw the last error
    if (!response) {
      throw error || new Error('All download attempts failed')
    }

    log.info(`Download successful. Status: ${response.status}, Content length: ${response.data.length} bytes`)

    // Write file to disk
    fs.writeFileSync(localPath, response.data)
    log.info(`File saved to: ${localPath}`)

    return {
      success: true,
      localPath
    }
  } catch (error) {
    log.error('Download error:', error)
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      log.error('Response status:', error.response.status)
      log.error('Response headers:', error.response.headers)

      // If the response is JSON, try to parse it
      if (error.response.headers['content-type']?.includes('application/json')) {
        try {
          const errorData = JSON.parse(Buffer.from(error.response.data).toString())
          log.error('Response data:', errorData)
        } catch (e) {
          log.error('Could not parse error response as JSON')
        }
      }
    } else if (error.request) {
      // The request was made but no response was received
      log.error('No response received. Request:', error.request)
    } else {
      // Something happened in setting up the request that triggered an Error
      log.error('Error setting up request:', error.message)
    }

    return {
      success: false,
      error: error.message || 'Unknown error'
    }
  }
}
