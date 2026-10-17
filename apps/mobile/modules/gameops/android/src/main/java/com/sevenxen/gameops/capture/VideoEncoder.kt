package com.sevenxen.gameops.capture

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.MediaMuxer
import android.util.Log
import android.view.Surface
import java.io.File

/**
 * H.264 (AVC) surface encoder → MP4 via MediaMuxer. Video only (audio is intentionally off for now:
 * AudioPlaybackCapture needs RECORD_AUDIO and games may opt out of capture; add an AAC track later).
 */
class VideoEncoder(
  val file: File,
  val width: Int,
  val height: Int,
  bitrate: Int,
  fps: Int,
  private val onError: (String) -> Unit,
) {
  private val codec: MediaCodec = MediaCodec.createEncoderByType(MIME)
  val inputSurface: Surface
  private var muxer: MediaMuxer? = MediaMuxer(file.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
  private var track = -1
  @Volatile
  private var muxerStarted = false
  @Volatile
  var bytesWritten = 0L
    private set
  private var firstPtsUs = -1L
  @Volatile
  var lastPtsUs = 0L
    private set
  private val drainThread: Thread
  @Volatile
  private var eosSignalled = false

  init {
    val format = MediaFormat.createVideoFormat(MIME, width, height).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
      setInteger(MediaFormat.KEY_FRAME_RATE, fps)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
      // keep the timeline moving when the screen is static (VirtualDisplay sends no frames then)
      setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 1_000_000L / fps * 3)
      setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR)
    }
    try {
      codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    } catch (e: Exception) {
      // some encoders reject BITRATE_MODE / repeat; retry with the bare minimum
      format.removeKey(MediaFormat.KEY_BITRATE_MODE)
      codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    }
    inputSurface = codec.createInputSurface()
    codec.start()
    drainThread = Thread({ drainLoop() }, "gameops-encoder").apply { start() }
  }

  val durationSec: Int get() = if (firstPtsUs < 0) 0 else ((lastPtsUs - firstPtsUs) / 1_000_000L).toInt()

  private fun drainLoop() {
    val info = MediaCodec.BufferInfo()
    try {
      while (true) {
        val idx = codec.dequeueOutputBuffer(info, 10_000)
        when {
          idx == MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
          idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            val m = muxer ?: break
            track = m.addTrack(codec.outputFormat)
            m.start()
            muxerStarted = true
          }
          idx >= 0 -> {
            val buf = codec.getOutputBuffer(idx)
            val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
            if (buf != null && info.size > 0 && !isConfig && muxerStarted) {
              buf.position(info.offset)
              buf.limit(info.offset + info.size)
              muxer?.writeSampleData(track, buf, info)
              bytesWritten += info.size
              if (firstPtsUs < 0) firstPtsUs = info.presentationTimeUs
              lastPtsUs = info.presentationTimeUs
            }
            codec.releaseOutputBuffer(idx, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
          }
        }
      }
    } catch (t: Throwable) {
      if (!eosSignalled) {
        Log.e(TAG, "encoder drain failed", t)
        onError("Video encoder failed: ${t.message}")
      }
    }
  }

  /** Finish the file. Returns true when a playable MP4 was written. Blocks up to ~3 s. */
  fun stop(): Boolean {
    eosSignalled = true
    try {
      codec.signalEndOfInputStream()
    } catch (t: Throwable) {
      Log.w(TAG, "signalEndOfInputStream", t)
    }
    drainThread.join(3000)
    if (drainThread.isAlive) drainThread.interrupt()
    try {
      codec.stop()
    } catch (_: Throwable) {
    }
    try {
      codec.release()
    } catch (_: Throwable) {
    }
    try {
      inputSurface.release()
    } catch (_: Throwable) {
    }
    var ok = false
    try {
      if (muxerStarted) {
        muxer?.stop()
        ok = bytesWritten > 0
      }
    } catch (t: Throwable) {
      Log.w(TAG, "muxer stop", t)
    }
    try {
      muxer?.release()
    } catch (_: Throwable) {
    }
    muxer = null
    if (!ok) file.delete()
    return ok
  }

  companion object {
    private const val TAG = "GameOps.Encoder"
    const val MIME = MediaFormat.MIMETYPE_VIDEO_AVC

    /**
     * Landscape output size for [quality] keeping the display's aspect (e.g. 2400×1080 → 1600×720 at 720p) when the
     * device's AVC encoder supports it, otherwise 16:9 (content letterboxed).
     */
    fun chooseSize(displayLong: Int, displayShort: Int, quality: String): Pair<Int, Int> {
      val short = if (quality == "1080p") 1080 else 720
      val aspect = displayLong.toFloat() / displayShort.coerceAtLeast(1)
      val long = ((short * aspect) / 16f).toInt() * 16
      val fallback = if (quality == "1080p") 1920 to 1080 else 1280 to 720
      return if (isSupported(long, short)) long to short else if (isSupported(fallback.first, fallback.second)) fallback else 1280 to 720
    }

    fun bitrateFor(quality: String) = if (quality == "1080p") 5_000_000 else 2_500_000

    private fun isSupported(w: Int, h: Int): Boolean = try {
      MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.any { info ->
        info.isEncoder && info.supportedTypes.any { it.equals(MIME, ignoreCase = true) } &&
          info.getCapabilitiesForType(MIME).videoCapabilities?.areSizeAndRateSupported(w, h, 30.0) == true
      }
    } catch (_: Throwable) {
      false
    }
  }
}
