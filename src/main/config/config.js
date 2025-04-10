import path from 'path'
import os from 'os'
import { app } from 'electron'

const isDev = process.env.NODE_ENV === 'development'
const isWin = process.platform === 'win32'

// Default to localhost for development, but allow overriding with environment variables
const DEFAULT_HOST = isDev ? '192.168.4.204' : '127.0.0.1'
const FACE2FACE_HOST = process.env.FACE2FACE_HOST || DEFAULT_HOST
const TTS_HOST = process.env.TTS_HOST || DEFAULT_HOST
const FILE_SERVER_HOST = process.env.FILE_SERVER_HOST || DEFAULT_HOST

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
