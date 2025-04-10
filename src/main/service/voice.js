import { selectAll, insert, selectByID } from '../dao/voice.js'
import { preprocessAndTran, makeAudio as makeAudioApi } from '../api/tts.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { assetPath, serviceUrl } from '../config/config.js'
import log from '../logger.js'
import { ipcMain } from 'electron'
import dayjs from 'dayjs'
import { uploadFile, downloadFile } from '../api/file-transfer.js'

const MODEL_NAME = 'voice'

export function getAllTimbre() {
  return selectAll()
}

export async function train(audioPath, lang = 'zh') {
  // For remote paths, we don't need to modify the path format
  // For local paths (during development), we need to upload the file first
  let remotePath = audioPath

  // Check if this is a local path that needs to be uploaded
  if (audioPath.includes('\\') || audioPath.startsWith('/')) {
    // This is a local path, upload it to the TTS server
    const localPath = audioPath.replace(/\\/g, '/') // Replace backslashes with forward slashes

    // Upload the audio file
    const uploadResult = await uploadFile(localPath, 'ttsFileServer', 'origin_audio')
    if (!uploadResult.success) {
      throw new Error(`Failed to upload audio: ${uploadResult.error}`)
    }

    // Use the remote path for the API call
    remotePath = uploadResult.remotePath
  }

  // Call the TTS service to preprocess and train
  const res = await preprocessAndTran({
    format: path.extname(remotePath).substring(1), // Remove the dot from extension
    reference_audio: remotePath,
    lang
  })

  log.debug('~ train ~ res:', res)

  if (res.code !== 0) {
    return false
  } else {
    const { asr_format_audio_url, reference_audio_text } = res
    return insert({
      origin_audio_path: remotePath,
      lang,
      asr_format_audio_url,
      reference_audio_text
    })
  }
}

export function makeAudio4Video({voiceId, text}) {
  return makeAudio({voiceId, text, targetDir: assetPath.ttsProduct})
}

export async function copyAudio4Video(filePath) {
  // Generate a unique filename
  const fileName = dayjs().format('YYYYMMDDHHmmssSSS') + path.extname(filePath)

  // Create local directory if it doesn't exist
  const targetDir = assetPath.ttsProduct
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  // Copy to local temp directory
  const localTargetPath = path.join(targetDir, fileName)
  fs.copyFileSync(filePath, localTargetPath)

  // Upload to TTS server
  const uploadResult = await uploadFile(localTargetPath, 'ttsFileServer', 'temp')
  if (!uploadResult.success) {
    throw new Error(`Failed to upload audio: ${uploadResult.error}`)
  }

  // Return the remote path
  return uploadResult.remotePath
}

export async function makeAudio({voiceId, text, targetDir}) {
  log.info(`Making audio - Voice ID: ${voiceId}, Text: ${text}, Target Dir: ${targetDir}`)

  const uuid = crypto.randomUUID()
  log.info(`Generated UUID: ${uuid}`)

  // Get voice data from database
  const voice = selectByID(voiceId)
  if (!voice) {
    log.error(`Voice with ID ${voiceId} not found`)
    throw new Error(`Voice with ID ${voiceId} not found`)
  }
  log.info(`Voice data:`, voice)

  // Create local directory if it doesn't exist
  if (!fs.existsSync(targetDir)) {
    log.info(`Creating directory: ${targetDir}`)
    fs.mkdirSync(targetDir, { recursive: true })
  }

  // Local file path
  const localFilePath = path.join(targetDir, `${uuid}.wav`)
  log.info(`Local file path: ${localFilePath}`)

  try {
    // Generate audio using TTS API
    log.info('Calling TTS API to generate audio...')
    const audioData = await makeAudioApi({
      speaker: uuid,
      text,
      format: 'wav',
      topP: 0.7,
      max_new_tokens: 1024,
      chunk_length: 100,
      repetition_penalty: 1.2,
      temperature: 0.7,
      need_asr: false,
      streaming: false,
      is_fixed_seed: 0,
      is_norm: 0,
      reference_audio: voice.asr_format_audio_url,
      reference_text: voice.reference_audio_text
    })

    log.info(`Audio generated successfully. Size: ${audioData.length} bytes`)

    // Save audio data to local file
    log.info(`Saving audio to local file: ${localFilePath}`)
    fs.writeFileSync(localFilePath, audioData, 'binary')
    log.info('Audio saved to local file')

    // Check if we should upload to server
    if (process.env.SKIP_UPLOAD === 'true') {
      log.info('Skipping upload to server (SKIP_UPLOAD=true)')
      return `${uuid}.wav`
    }

    // Upload to TTS server
    log.info(`Uploading audio to TTS server...`)
    const uploadResult = await uploadFile(localFilePath, 'ttsFileServer', 'audio')

    if (!uploadResult.success) {
      log.error(`Failed to upload audio: ${uploadResult.error}`)
      log.info('Using local path as fallback')
      return `${uuid}.wav`
    }

    log.info(`Upload successful. Remote path: ${uploadResult.remotePath}`)

    // Return the remote path
    return uploadResult.remotePath
  } catch (error) {
    log.error('Error generating audio:', error)
    log.error(error.stack)
    throw error
  }
}

/**
 * 试听音频
 * @param {string} voiceId
 * @param {string} text
 * @returns {Promise<string>} Local path to the audio file
 */
export async function audition(voiceId, text) {
  log.info(`Audition request - Voice ID: ${voiceId}, Text: ${text}`)

  const tmpDir = require('os').tmpdir()
  log.info(`Audition temp directory: ${tmpDir}`)

  // Get voice data from database
  const voice = selectByID(voiceId)
  if (!voice) {
    log.error(`Voice with ID ${voiceId} not found`)
    throw new Error(`Voice with ID ${voiceId} not found`)
  }
  log.info(`Voice data:`, voice)

  // Generate audio and get the path (could be remote or local)
  log.info('Generating audio...')
  const audioPathOrRemotePath = await makeAudio({ voiceId, text, targetDir: tmpDir })
  log.info(`Audio generated. Path: ${audioPathOrRemotePath}`)

  // If it's a local path (contains no slashes), return the full path
  if (!audioPathOrRemotePath.includes('/')) {
    const fullPath = path.join(tmpDir, audioPathOrRemotePath)
    log.info(`Using local audio file: ${fullPath}`)
    return fullPath
  }

  // If it's a remote path, download it
  log.info(`Remote audio path detected. Downloading file...`)
  const localFileName = `audition_${crypto.randomUUID()}.wav`
  const localFilePath = path.join(tmpDir, localFileName)
  log.info(`Local file path for downloaded audio: ${localFilePath}`)

  try {
    // Try to download the file
    log.info(`Downloading from ${audioPathOrRemotePath} to ${localFilePath}`)
    const downloadResult = await downloadFile(
      audioPathOrRemotePath,
      localFilePath,
      'ttsFileServer'
    )

    if (!downloadResult.success) {
      log.error(`Download failed: ${downloadResult.error}`)

      // As a fallback, try to generate the audio again but save it locally
      log.info('Trying fallback: generating audio directly to local file...')
      const fallbackAudio = await makeAudioApi({
        speaker: crypto.randomUUID(),
        text,
        format: 'wav',
        topP: 0.7,
        max_new_tokens: 1024,
        chunk_length: 100,
        repetition_penalty: 1.2,
        temperature: 0.7,
        need_asr: false,
        streaming: false,
        is_fixed_seed: 0,
        is_norm: 0,
        reference_audio: voice.asr_format_audio_url,
        reference_text: voice.reference_audio_text
      })

      // Save the audio data to a local file
      fs.writeFileSync(localFilePath, fallbackAudio, 'binary')
      log.info(`Fallback successful. Audio saved to: ${localFilePath}`)
      return localFilePath
    }

    log.info(`Download successful. Audio saved to: ${localFilePath}`)
    return localFilePath
  } catch (error) {
    log.error(`Error during audio download: ${error.message}`)
    log.error(error.stack)
    throw error
  }
}

export function init() {
  ipcMain.handle(MODEL_NAME + '/audition', async (event, ...args) => {
    return await audition(...args)
  })
}