import path from 'path'
import os from 'os'
import { app } from 'electron'

const isDev = process.env.NODE_ENV === 'development'
const isWin = process.platform === 'win32'

// Get the actual IP address from the environment or use localhost as fallback
const getLocalIpAddress = () => {
  try {
    const os = require('os')
    const networkInterfaces = os.networkInterfaces()

    // Find the first non-internal IPv4 address
    for (const interfaceName in networkInterfaces) {
      const interfaces = networkInterfaces[interfaceName]
      for (const iface of interfaces) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address
        }
      }
    }
  } catch (error) {
    console.error('Error getting local IP address:', error)
  }

  return '127.0.0.1'
}

// Default to localhost for development, but allow overriding with environment variables
const DEFAULT_HOST = process.env.DEFAULT_HOST || '127.0.0.1' // Default to localhost
const FACE2FACE_HOST = process.env.FACE2FACE_HOST || DEFAULT_HOST
const TTS_HOST = process.env.TTS_HOST || DEFAULT_HOST
const FILE_SERVER_HOST = process.env.FILE_SERVER_HOST || DEFAULT_HOST

// Log the hosts being used
console.log('Using hosts:')
console.log('DEFAULT_HOST:', DEFAULT_HOST)
console.log('FACE2FACE_HOST:', FACE2FACE_HOST)
console.log('TTS_HOST:', TTS_HOST)
console.log('FILE_SERVER_HOST:', FILE_SERVER_HOST)

// Service URLs for API endpoints
export const serviceUrl = {
  face2face: `http://${FACE2FACE_HOST}:8383/easy`,
  tts: `http://${TTS_HOST}:18180`,
  face2faceFileServer: `http://${FACE2FACE_HOST}:8384`,
  ttsFileServer: `http://${TTS_HOST}:18181`
}

// Local paths for temporary file storage
export const assetPath = {
  model: path.join(app.getPath('userData'), 'temp', 'face2face'), // 模特视频
  ttsProduct: path.join(app.getPath('userData'), 'temp', 'tts'), // TTS 产物
  ttsRoot: path.join(app.getPath('userData'), 'temp', 'voice'), // TTS服务根目录
  ttsTrain: path.join(app.getPath('userData'), 'temp', 'voice', 'origin_audio') // TTS 训练产物
}

// File server configuration
export const fileServer = {
  face2face: {
    port: 8384,
    tempDir: isWin
      ? path.join('D:', 'heygem_data', 'face2face')
      : path.join(os.homedir(), 'heygem_data', 'face2face')
  },
  tts: {
    port: 18181,
    tempDir: isWin
      ? path.join('D:', 'heygem_data', 'voice', 'data')
      : path.join(os.homedir(), 'heygem_data', 'voice', 'data')
  }
}
