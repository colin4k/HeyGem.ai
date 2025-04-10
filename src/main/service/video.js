import { ipcMain } from 'electron'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import { isEmpty } from 'lodash'
import { assetPath, serviceUrl } from '../config/config.js'
import { selectPage,selectByStatus, updateStatus, remove as deleteVideo, findFirstByStatus } from '../dao/video.js'
import { selectByID as selectF2FModelByID } from '../dao/f2f-model.js'
import { selectByID as selectVoiceByID } from '../dao/voice.js'
import {
  insert as insertVideo,
  count,
  update,
  selectByID as selectVideoByID
} from '../dao/video.js'
import { makeAudio4Video, copyAudio4Video } from './voice.js'
import { makeVideo as makeVideoApi,getVideoStatus } from '../api/f2f.js'
import log from '../logger.js'
import { getVideoDuration } from '../util/ffmpeg.js'
import { uploadFile, downloadFile } from '../api/file-transfer.js'

const MODEL_NAME = 'video'

/**
 * 分页查询合成结果
 * @param {number} page
 * @param {number} pageSize
 * @returns
 */
async function page({ page, pageSize, name = '' }) {
  // 查询的有waiting状态的视频
  const waitingVideos = selectByStatus('waiting').map((v) => v.id)
  const total = count(name)

  // Get videos from database
  const videos = selectPage({ page, pageSize, name })

  // Process each video - download files if needed
  const videoPromises = videos.map(async (video) => {
    let processedVideo = { ...video }

    // If there's a file path and it's a remote path (contains slashes)
    if (video.file_path && video.file_path.includes('/')) {
      // Local path where we'll store the downloaded file
      const localFilePath = path.join(assetPath.model, path.basename(video.file_path))

      // Download if it doesn't exist locally
      if (!fs.existsSync(localFilePath)) {
        try {
          const downloadResult = await downloadFile(
            video.file_path,
            localFilePath,
            'face2faceFileServer'
          )
          if (!downloadResult.success) {
            log.error(`Failed to download video: ${downloadResult.error}`)
          }
        } catch (error) {
          log.error(`Error downloading video: ${error.message}`)
        }
      }

      processedVideo.file_path = localFilePath
    } else if (video.file_path) {
      // It's a local path reference, construct the full path
      processedVideo.file_path = path.join(assetPath.model, video.file_path)
    }

    // Add progress information for waiting videos
    if (video.status === 'waiting') {
      processedVideo.progress = `${waitingVideos.indexOf(video.id) + 1} / ${waitingVideos.length}`
    }

    return processedVideo
  })

  const processedVideos = await Promise.all(videoPromises)

  return {
    total,
    list: processedVideos
  }
}

async function findVideo(videoId) {
  const video = selectVideoByID(videoId)
  let processedVideo = { ...video }

  // If there's a file path and it's a remote path (contains slashes)
  if (video.file_path && video.file_path.includes('/')) {
    // Local path where we'll store the downloaded file
    const localFilePath = path.join(assetPath.model, path.basename(video.file_path))

    // Download if it doesn't exist locally
    if (!fs.existsSync(localFilePath)) {
      try {
        const downloadResult = await downloadFile(
          video.file_path,
          localFilePath,
          'face2faceFileServer'
        )
        if (!downloadResult.success) {
          log.error(`Failed to download video: ${downloadResult.error}`)
        }
      } catch (error) {
        log.error(`Error downloading video: ${error.message}`)
      }
    }

    processedVideo.file_path = localFilePath
  } else if (video.file_path) {
    // It's a local path reference, construct the full path
    processedVideo.file_path = path.join(assetPath.model, video.file_path)
  }

  return processedVideo
}

function countVideo(name = '') {
  return count(name)
}

async function saveVideo({ id, model_id, name, text_content, voice_id, audio_path }) {
  const video = selectVideoByID(id)

  // If audio path is provided, upload it to the server
  if (audio_path) {
    audio_path = await copyAudio4Video(audio_path)
  }

  if (video) {
    return update({ id, model_id, name, text_content, voice_id, audio_path })
  }
  return insertVideo({ model_id, name, status: 'draft', text_content, voice_id, audio_path })
}

/**
 * 合成视频
 * 更新视频状态为waiting
 * @param {number} videoId
 * @returns
 */
function makeVideo(videoId) {
  update({ id: videoId, status: 'waiting' })
  return videoId
}

export async function synthesisVideo(videoId) {
  try{
    update({
      id: videoId,
      file_path: null,
      status: 'pending',
      message: '正在提交任务',
    })

    // 查询Video
    const video = selectVideoByID(videoId)
    log.debug('~ makeVideo ~ video:', video)

    // 根据modelId获取model信息
    const model = selectF2FModelByID(video.model_id)
    log.debug('~ makeVideo ~ model:', model)

    let audioPath
    if(video.audio_path){
      // 将audio_path复制到ttsProduct目录下
      audioPath = video.audio_path
    }else{
      // 根据model信息中的voiceId获取voice信息
      const voice = selectVoiceByID(video.voice_id || model.voice_id)
      log.debug('~ makeVideo ~ voice:', voice)

      // 调用tts接口生成音频
      audioPath = await makeAudio4Video({
        voiceId: voice.id,
        text: video.text_content
      })
      log.debug('~ makeVideo ~ audioPath:', audioPath)
    }

    // 调用视频生成接口生成视频
    let result, param
    if (process.env.NODE_ENV === 'development') {
      // 写死调试
      ({ result, param } = await makeVideoByF2F('test.wav', 'test.mp4'))
    } else {
      ({ result, param } = await makeVideoByF2F(audioPath, model.video_path))
    }

    log.debug('~ makeVideo ~ result, param:', result, param)

    // 插入视频表
    if(10000 === result.code){ // 成功
      update({
        id: videoId,
        file_path: null,
        status: 'pending',
        message: result,
        audio_path: audioPath,
        param,
        code: param.code
      })
    }else{ // 失败
      update({
        id: videoId,
        file_path: null,
        status: 'failed',
        message: result.msg,
        audio_path: audioPath,
        param,
        code: param.code
      })
    }
  } catch (error) {
    log.error('~ synthesisVideo ~ error:', error.message)
    updateStatus(videoId, 'failed', error.message)
  }

  // 6. 返回视频id
  return videoId
}

export async function loopPending() {
  const video = findFirstByStatus('pending')
  if (!video) {
    synthesisNext()

    setTimeout(() => {
      loopPending()
    }, 2000)
    return
  }

  const statusRes = await getVideoStatus(video.code)

  if ([9999, 10002, 10003].includes(statusRes.code)) {
    updateStatus(video.id, 'failed', statusRes.msg)
  } else if (statusRes.code === 10000) {
    if (statusRes.data.status === 1) {
      updateStatus(
        video.id,
        'pending',
        statusRes.data.msg,
        statusRes.data.progress,
      )
    }else if (statusRes.data.status === 2) { // 合成成功
      // ffmpeg 获取视频时长
      let duration
      if(process.env.NODE_ENV === 'development'){
        duration = 88
      }else{
        const resultPath = path.join(assetPath.model, statusRes.data.result)
        duration = await getVideoDuration(resultPath)
      }

      update({
        id: video.id,
        status: 'success',
        message: statusRes.data.msg,
        progress: statusRes.data.progress,
        file_path: statusRes.data.result,
        duration
      })

    } else if (statusRes.data.status === 3) {
      updateStatus(video.id, 'failed', statusRes.data.msg)
    }
  }

  setTimeout(() => {
    loopPending()
  }, 2000)
  return video
}

/**
 * 合成下一个视频
 */
function synthesisNext() {
  // 查询所有未完成的视频任务
  const video = findFirstByStatus('waiting')
  if (video) {
    synthesisVideo(video.id)
  }
}

async function removeVideo(videoId) {
  // 查询视频
  const video = selectVideoByID(videoId)
  log.debug('~ removeVideo ~ videoId:', videoId)

  // Delete local video file if it exists
  let localVideoPath
  if (video.file_path && video.file_path.includes('/')) {
    // It's a remote path, get the local version if it exists
    localVideoPath = path.join(assetPath.model, path.basename(video.file_path))
  } else if (video.file_path) {
    // It's a local path reference
    localVideoPath = path.join(assetPath.model, video.file_path)
  }

  if (localVideoPath && fs.existsSync(localVideoPath)) {
    fs.unlinkSync(localVideoPath)
  }

  // Delete local audio file if it exists
  let localAudioPath
  if (video.audio_path && video.audio_path.includes('/')) {
    // It's a remote path, get the local version if it exists
    localAudioPath = path.join(assetPath.model, path.basename(video.audio_path))
  } else if (video.audio_path) {
    // It's a local path reference
    localAudioPath = path.join(assetPath.model, video.audio_path)
  }

  if (localAudioPath && fs.existsSync(localAudioPath)) {
    fs.unlinkSync(localAudioPath)
  }

  // TODO: Add API endpoints to delete remote files
  // For now, we'll just delete the database entry

  // 删除视频表
  return deleteVideo(videoId)
}

async function exportVideo(videoId, outputPath) {
  const video = selectVideoByID(videoId)

  let filePath
  if (video.file_path && video.file_path.includes('/')) {
    // It's a remote path, download it if needed
    const localFilePath = path.join(assetPath.model, path.basename(video.file_path))

    // Download if it doesn't exist locally
    if (!fs.existsSync(localFilePath)) {
      try {
        const downloadResult = await downloadFile(
          video.file_path,
          localFilePath,
          'face2faceFileServer'
        )
        if (!downloadResult.success) {
          throw new Error(`Failed to download video: ${downloadResult.error}`)
        }
      } catch (error) {
        log.error(`Error downloading video for export: ${error.message}`)
        throw error
      }
    }

    filePath = localFilePath
  } else {
    // It's a local path reference
    filePath = path.join(assetPath.model, video.file_path)
  }

  // Copy the file to the output path
  fs.copyFileSync(filePath, outputPath)
}

/**
 * 调用face2face生成视频
 * @param {string} audioPath
 * @param {string} videoPath
 * @returns
 */
async function makeVideoByF2F(audioPath, videoPath) {
  const uuid = crypto.randomUUID()
  const param = {
    audio_url: audioPath,
    video_url: videoPath,
    code: uuid,
    chaofen: 0,
    watermark_switch: 0,
    pn: 1
  }
  const result = await makeVideoApi(param)
  return { param, result }
}

function modify(video) {
  return update(video)
}

export function init() {
  ipcMain.handle(MODEL_NAME + '/page', async (event, ...args) => {
    return await page(...args)
  })
  ipcMain.handle(MODEL_NAME + '/make', (event, ...args) => {
    return makeVideo(...args)
  })
  ipcMain.handle(MODEL_NAME + '/modify', (event, ...args) => {
    return modify(...args)
  })
  ipcMain.handle(MODEL_NAME + '/save', async (event, ...args) => {
    return await saveVideo(...args)
  })
  ipcMain.handle(MODEL_NAME + '/find', async (event, ...args) => {
    return await findVideo(...args)
  })
  ipcMain.handle(MODEL_NAME + '/count', (event, ...args) => {
    return countVideo(...args)
  })
  ipcMain.handle(MODEL_NAME + '/export', async (event, ...args) => {
    return await exportVideo(...args)
  })
  ipcMain.handle(MODEL_NAME + '/remove', async (event, ...args) => {
    return await removeVideo(...args)
  })
}
