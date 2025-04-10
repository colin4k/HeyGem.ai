import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import dayjs from 'dayjs'
import { isEmpty } from 'lodash'
import { insert, selectPage, count, selectByID, remove as deleteModel } from '../dao/f2f-model.js'
import { train as trainVoice } from './voice.js'
import { assetPath, serviceUrl } from '../config/config.js'
import log from '../logger.js'
import { extractAudio } from '../util/ffmpeg.js'
import { uploadFile, downloadFile } from '../api/file-transfer.js'
const MODEL_NAME = 'model'

/**
 * 新增模特
 * @param {string} modelName 模特名称
 * @param {string} videoPath 模特视频路径
 * @returns
 */
async function addModel(modelName, videoPath) {
  if (!fs.existsSync(assetPath.model)) {
    fs.mkdirSync(assetPath.model, {
      recursive: true
    })
  }

  // Generate a unique filename
  const extname = path.extname(videoPath)
  const modelFileName = dayjs().format('YYYYMMDDHHmmssSSS') + extname
  const modelPath = path.join(assetPath.model, modelFileName)

  // Copy video to local temp directory
  fs.copyFileSync(videoPath, modelPath)

  // Extract audio from video
  if (!fs.existsSync(assetPath.ttsTrain)) {
    fs.mkdirSync(assetPath.ttsTrain, {
      recursive: true
    })
  }

  const audioPath = path.join(assetPath.ttsTrain, modelFileName.replace(extname, '.wav'))
  await extractAudio(modelPath, audioPath)

  // Upload video file to face2face server
  const videoUploadResult = await uploadFile(modelPath, 'face2faceFileServer', 'model')
  if (!videoUploadResult.success) {
    throw new Error(`Failed to upload video: ${videoUploadResult.error}`)
  }

  // Upload audio file to TTS server
  const audioUploadResult = await uploadFile(audioPath, 'ttsFileServer', 'origin_audio')
  if (!audioUploadResult.success) {
    throw new Error(`Failed to upload audio: ${audioUploadResult.error}`)
  }

  // Train voice model using the uploaded audio
  let voiceId
  if (process.env.NODE_ENV === 'development') {
    // For development testing
    voiceId = await trainVoice('origin_audio/test.wav', 'zh')
  } else {
    // Use the remote path returned from the upload
    voiceId = await trainVoice(audioUploadResult.remotePath, 'zh')
  }

  // Insert model info to database
  // Store both local and remote paths
  const id = insert({
    modelName,
    videoPath: videoUploadResult.remotePath, // Remote path on face2face server
    audioPath: audioUploadResult.remotePath, // Remote path on TTS server
    voiceId
  })

  return id
}

async function page({ page, pageSize, name = '' }) {
  const total = count(name)

  // Get models from database
  const models = selectPage({ page, pageSize, name })

  // For each model, download the files if they don't exist locally
  const modelPromises = models.map(async (model) => {
    // Local paths where we'll store the downloaded files
    const localVideoPath = path.join(assetPath.model, path.basename(model.video_path))
    const localAudioPath = path.join(assetPath.ttsRoot, path.basename(model.audio_path))

    // Download video if it doesn't exist locally
    if (!fs.existsSync(localVideoPath)) {
      try {
        const videoDownloadResult = await downloadFile(
          model.video_path,
          localVideoPath,
          'face2faceFileServer'
        )
        if (!videoDownloadResult.success) {
          log.error(`Failed to download video: ${videoDownloadResult.error}`)
        }
      } catch (error) {
        log.error(`Error downloading video: ${error.message}`)
      }
    }

    // Download audio if it doesn't exist locally
    if (!fs.existsSync(localAudioPath)) {
      try {
        const audioDownloadResult = await downloadFile(
          model.audio_path,
          localAudioPath,
          'ttsFileServer'
        )
        if (!audioDownloadResult.success) {
          log.error(`Failed to download audio: ${audioDownloadResult.error}`)
        }
      } catch (error) {
        log.error(`Error downloading audio: ${error.message}`)
      }
    }

    return {
      ...model,
      video_path: localVideoPath,
      audio_path: localAudioPath
    }
  })

  const processedModels = await Promise.all(modelPromises)

  return {
    total,
    list: processedModels
  }
}

async function findModel(modelId) {
  const model = selectByID(modelId)

  // Local paths where we'll store the downloaded files
  const localVideoPath = path.join(assetPath.model, path.basename(model.video_path))
  const localAudioPath = path.join(assetPath.ttsRoot, path.basename(model.audio_path))

  // Download video if it doesn't exist locally
  if (!fs.existsSync(localVideoPath)) {
    try {
      const videoDownloadResult = await downloadFile(
        model.video_path,
        localVideoPath,
        'face2faceFileServer'
      )
      if (!videoDownloadResult.success) {
        log.error(`Failed to download video: ${videoDownloadResult.error}`)
      }
    } catch (error) {
      log.error(`Error downloading video: ${error.message}`)
    }
  }

  // Download audio if it doesn't exist locally
  if (!fs.existsSync(localAudioPath)) {
    try {
      const audioDownloadResult = await downloadFile(
        model.audio_path,
        localAudioPath,
        'ttsFileServer'
      )
      if (!audioDownloadResult.success) {
        log.error(`Failed to download audio: ${audioDownloadResult.error}`)
      }
    } catch (error) {
      log.error(`Error downloading audio: ${error.message}`)
    }
  }

  return {
    ...model,
    video_path: localVideoPath,
    audio_path: localAudioPath
  }
}

async function removeModel(modelId) {
  const model = selectByID(modelId)
  log.debug('~ removeModel ~ modelId:', modelId)

  // Delete local video file if it exists
  const localVideoPath = path.join(assetPath.model, path.basename(model.video_path || ''))
  if (!isEmpty(model.video_path) && fs.existsSync(localVideoPath)) {
    fs.unlinkSync(localVideoPath)
  }

  // Delete local audio file if it exists
  const localAudioPath = path.join(assetPath.ttsRoot, path.basename(model.audio_path || ''))
  if (!isEmpty(model.audio_path) && fs.existsSync(localAudioPath)) {
    fs.unlinkSync(localAudioPath)
  }

  // TODO: Add API endpoints to delete remote files
  // For now, we'll just delete the database entry

  deleteModel(modelId)
}

function countModel(name = '') {
  return count(name)
}

export function init() {
  ipcMain.handle(MODEL_NAME + '/addModel', async (event, ...args) => {
    return await addModel(...args)
  })
  ipcMain.handle(MODEL_NAME + '/page', async (event, ...args) => {
    return await page(...args)
  })
  ipcMain.handle(MODEL_NAME + '/find', async (event, ...args) => {
    return await findModel(...args)
  })
  ipcMain.handle(MODEL_NAME + '/count', (event, ...args) => {
    return countModel(...args)
  })
  ipcMain.handle(MODEL_NAME + '/remove', async (event, ...args) => {
    return await removeModel(...args)
  })
}
