package com.sevenxen.gameops.capture

import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.graphics.SurfaceTexture
import android.media.Image
import android.media.ImageReader
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Surface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Fans the single MediaProjection VirtualDisplay out to several consumers with OpenGL ES
 * (Android 14+ allows only ONE createVirtualDisplay per MediaProjection, so separate VirtualDisplays per
 * consumer are not an option):
 *
 *   VirtualDisplay → SurfaceTexture (OES texture) ─┬→ MediaCodec input surface (≤30 fps, letterboxed to the
 *                                                  │   landscape encoder size; skipped while paused)
 *                                                  ├→ ImageReader ~640 px wide every [detectorIntervalMs] → detector
 *                                                  └→ full-resolution ImageReader on demand → JPEG stills
 *
 * All GL work happens on one thread. The last frame stays in the texture, so stills/detector frames work even
 * when the screen is static (VirtualDisplay only produces frames on change).
 */
class FrameRouter(
  private val listener: Listener,
  private val detectorLongSide: Int = 640,
  private val detectorIntervalMs: Long = 500L,
  private val fps: Int = 30,
) : SurfaceTexture.OnFrameAvailableListener {

  interface Listener {
    /** analysis thread; [argb] is a fresh array the receiver may keep */
    fun onDetectorFrame(argb: IntArray, width: Int, height: Int)
    fun onRouterError(message: String)
  }

  private val glThread = HandlerThread("gameops-gl").apply { start() }
  private val gl = Handler(glThread.looper)
  private val readerThread = HandlerThread("gameops-frames").apply { start() }
  private val readerHandler = Handler(readerThread.looper)

  private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
  private var context: EGLContext = EGL14.EGL_NO_CONTEXT
  private var config: EGLConfig? = null
  private var pbuffer: EGLSurface = EGL14.EGL_NO_SURFACE

  private var texId = 0
  private var surfaceTexture: SurfaceTexture? = null
  @Volatile
  var inputSurface: Surface? = null
    private set

  private var program = 0
  private var aPos = 0
  private var aTex = 0
  private var uTexMatrix = 0
  private val texMatrix = FloatArray(16)
  private val quadPos = floatBuffer(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f))
  private val quadTex = floatBuffer(floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f, 1f, 1f))

  @Volatile
  var sourceW = 0
    private set
  @Volatile
  var sourceH = 0
    private set
  private var hasFrame = false

  // encoder output
  private var encSurface: EGLSurface = EGL14.EGL_NO_SURFACE
  private var encW = 0
  private var encH = 0
  @Volatile
  private var paused = false
  private var pauseStartedNs = 0L
  private var pausedTotalNs = 0L
  private var lastEncodedNs = 0L
  private var lastPresentedNs = 0L

  // detector output
  private var detReader: ImageReader? = null
  private var detSurface: EGLSurface = EGL14.EGL_NO_SURFACE
  @Volatile
  private var detBusy = false
  @Volatile
  var detectorEnabled = true

  // still output
  private var stillReader: ImageReader? = null
  private var stillSurface: EGLSurface = EGL14.EGL_NO_SURFACE
  @Volatile
  private var pendingStill: ((Bitmap?) -> Unit)? = null

  private var released = false

  private val detectorTick = object : Runnable {
    override fun run() {
      if (released) return
      try {
        if (detectorEnabled && !paused && hasFrame && !detBusy && detSurface != EGL14.EGL_NO_SURFACE) {
          detBusy = true
          renderTo(detSurface, detReader!!.width, detReader!!.height, null)
        }
      } catch (t: Throwable) {
        detBusy = false
        Log.w(TAG, "detector render failed", t)
      }
      gl.postDelayed(this, detectorIntervalMs)
    }
  }

  // ---------------------------------------------------------------- lifecycle

  /** Creates the EGL context and the input surface for the VirtualDisplay (blocking). */
  fun start(width: Int, height: Int): Surface {
    runOnGlSync {
      setupEgl()
      setupProgram()
      val tex = IntArray(1)
      GLES20.glGenTextures(1, tex, 0)
      texId = tex[0]
      GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texId)
      GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
      GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
      GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
      GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
      val st = SurfaceTexture(texId)
      st.setDefaultBufferSize(width, height)
      st.setOnFrameAvailableListener(this, gl)
      surfaceTexture = st
      inputSurface = Surface(st)
      sourceW = width
      sourceH = height
      createReaders()
    }
    gl.postDelayed(detectorTick, detectorIntervalMs)
    return requireNotNull(inputSurface) { "GL setup failed" }
  }

  /** Display rotated / captured content resized: the VirtualDisplay was resized to [width]×[height]. */
  fun resize(width: Int, height: Int) = gl.post {
    if (released || (width == sourceW && height == sourceH)) return@post
    sourceW = width
    sourceH = height
    surfaceTexture?.setDefaultBufferSize(width, height)
    hasFrame = false
    createReaders()
  }

  fun setEncoderSurface(surface: Surface?, width: Int, height: Int) = runOnGlSync {
    if (encSurface != EGL14.EGL_NO_SURFACE) {
      EGL14.eglDestroySurface(display, encSurface)
      encSurface = EGL14.EGL_NO_SURFACE
    }
    if (surface != null) {
      encSurface = EGL14.eglCreateWindowSurface(display, config, surface, intArrayOf(EGL14.EGL_NONE), 0)
      checkEgl("encoder surface")
      encW = width
      encH = height
      lastEncodedNs = 0
    }
  }

  fun setPaused(p: Boolean) = gl.post {
    if (p == paused) return@post
    val now = System.nanoTime()
    if (p) pauseStartedNs = now else pausedTotalNs += now - pauseStartedNs
    paused = p
  }

  /** Grab the current screen at full resolution. [cb] runs on a background thread (null = no frame yet / failure). */
  fun requestStill(cb: (Bitmap?) -> Unit) = gl.post {
    if (released || !hasFrame || stillSurface == EGL14.EGL_NO_SURFACE) {
      cb(null)
      return@post
    }
    if (pendingStill != null) {
      cb(null)
      return@post
    }
    pendingStill = cb
    try {
      renderTo(stillSurface, stillReader!!.width, stillReader!!.height, null)
    } catch (t: Throwable) {
      pendingStill = null
      cb(null)
    }
    // safety: never leave a caller hanging
    gl.postDelayed({ if (pendingStill === cb) { pendingStill = null; cb(null) } }, 2000)
  }

  fun release() {
    if (released) return
    runOnGlSync {
      released = true
      gl.removeCallbacksAndMessages(null)
      try {
        surfaceTexture?.setOnFrameAvailableListener(null)
        destroySurface(encSurface); encSurface = EGL14.EGL_NO_SURFACE
        destroySurface(detSurface); detSurface = EGL14.EGL_NO_SURFACE
        destroySurface(stillSurface); stillSurface = EGL14.EGL_NO_SURFACE
        detReader?.close(); detReader = null
        stillReader?.close(); stillReader = null
        inputSurface?.release(); inputSurface = null
        surfaceTexture?.release(); surfaceTexture = null
        if (program != 0) GLES20.glDeleteProgram(program)
        if (texId != 0) GLES20.glDeleteTextures(1, intArrayOf(texId), 0)
        EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
        destroySurface(pbuffer)
        EGL14.eglDestroyContext(display, context)
        EGL14.eglReleaseThread()
        EGL14.eglTerminate(display)
      } catch (t: Throwable) {
        Log.w(TAG, "release", t)
      }
    }
    pendingStill?.let { pendingStill = null; it(null) }
    glThread.quitSafely()
    readerThread.quitSafely()
  }

  // ---------------------------------------------------------------- frames

  override fun onFrameAvailable(st: SurfaceTexture) {
    if (released) return
    try {
      st.updateTexImage()
      st.getTransformMatrix(texMatrix)
      hasFrame = true
      val ts = st.timestamp
      if (!paused && encSurface != EGL14.EGL_NO_SURFACE) {
        val minInterval = 1_000_000_000L / fps - 3_000_000L
        if (lastEncodedNs == 0L || ts - lastEncodedNs >= minInterval) {
          var pts = ts - pausedTotalNs
          if (pts <= lastPresentedNs) pts = lastPresentedNs + 1_000_000L
          renderTo(encSurface, encW, encH, pts)
          lastEncodedNs = ts
          lastPresentedNs = pts
        }
      }
    } catch (t: Throwable) {
      Log.w(TAG, "frame", t)
      listener.onRouterError("Frame processing failed: ${t.message}")
    }
  }

  /** Draw the current texture into [surface] letterboxed (aspect preserved) and swap. */
  private fun renderTo(surface: EGLSurface, w: Int, h: Int, ptsNs: Long?) {
    if (!EGL14.eglMakeCurrent(display, surface, surface, context)) {
      throw IllegalStateException("eglMakeCurrent failed: 0x" + Integer.toHexString(EGL14.eglGetError()))
    }
    GLES20.glViewport(0, 0, w, h)
    GLES20.glClearColor(0f, 0f, 0f, 1f)
    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
    val sw = sourceW.coerceAtLeast(1).toFloat()
    val sh = sourceH.coerceAtLeast(1).toFloat()
    val scale = minOf(w / sw, h / sh)
    val vw = (sw * scale).toInt()
    val vh = (sh * scale).toInt()
    GLES20.glViewport((w - vw) / 2, (h - vh) / 2, vw, vh)
    GLES20.glUseProgram(program)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texId)
    GLES20.glUniformMatrix4fv(uTexMatrix, 1, false, texMatrix, 0)
    GLES20.glEnableVertexAttribArray(aPos)
    GLES20.glVertexAttribPointer(aPos, 2, GLES20.GL_FLOAT, false, 8, quadPos)
    GLES20.glEnableVertexAttribArray(aTex)
    GLES20.glVertexAttribPointer(aTex, 2, GLES20.GL_FLOAT, false, 8, quadTex)
    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
    if (ptsNs != null) EGLExt.eglPresentationTimeANDROID(display, surface, ptsNs)
    EGL14.eglSwapBuffers(display, surface)
  }

  private fun createReaders() {
    destroySurface(detSurface); detSurface = EGL14.EGL_NO_SURFACE
    destroySurface(stillSurface); stillSurface = EGL14.EGL_NO_SURFACE
    detReader?.close()
    stillReader?.close()
    detBusy = false

    // detector: long side = detectorLongSide, same aspect as the source
    val (dw, dh) = if (sourceW >= sourceH) {
      detectorLongSide to even(detectorLongSide.toLong() * sourceH / sourceW)
    } else {
      even(detectorLongSide.toLong() * sourceW / sourceH) to detectorLongSide
    }
    val dr = ImageReader.newInstance(dw, dh, PixelFormat.RGBA_8888, 2)
    dr.setOnImageAvailableListener({ r -> onDetectorImage(r) }, readerHandler)
    detReader = dr
    detSurface = EGL14.eglCreateWindowSurface(display, config, dr.surface, intArrayOf(EGL14.EGL_NONE), 0)

    val sr = ImageReader.newInstance(sourceW, sourceH, PixelFormat.RGBA_8888, 2)
    sr.setOnImageAvailableListener({ r -> onStillImage(r) }, readerHandler)
    stillReader = sr
    stillSurface = EGL14.eglCreateWindowSurface(display, config, sr.surface, intArrayOf(EGL14.EGL_NONE), 0)
    checkEgl("reader surfaces")
  }

  private fun onDetectorImage(r: ImageReader) {
    val img = try {
      r.acquireLatestImage()
    } catch (t: Throwable) {
      null
    } ?: return
    try {
      val bmp = imageToBitmap(img)
      val argb = IntArray(bmp.width * bmp.height)
      bmp.getPixels(argb, 0, bmp.width, 0, 0, bmp.width, bmp.height)
      val w = bmp.width
      val h = bmp.height
      bmp.recycle()
      listener.onDetectorFrame(argb, w, h)
    } catch (t: Throwable) {
      Log.w(TAG, "detector frame", t)
    } finally {
      img.close()
      detBusy = false
    }
  }

  private fun onStillImage(r: ImageReader) {
    val img = try {
      r.acquireLatestImage()
    } catch (t: Throwable) {
      null
    } ?: return
    val cb = pendingStill
    pendingStill = null
    try {
      if (cb == null) return
      cb(imageToBitmap(img))
    } catch (t: Throwable) {
      Log.w(TAG, "still", t)
      cb?.invoke(null)
    } finally {
      img.close()
    }
  }

  // ---------------------------------------------------------------- EGL / GL setup

  private fun setupEgl() {
    display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
    val v = IntArray(2)
    if (!EGL14.eglInitialize(display, v, 0, v, 1)) throw IllegalStateException("eglInitialize failed")
    val attrs = intArrayOf(
      EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
      EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
      EGL_RECORDABLE_ANDROID, 1,
      EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT or EGL14.EGL_PBUFFER_BIT,
      EGL14.EGL_NONE,
    )
    val configs = arrayOfNulls<EGLConfig>(1)
    val n = IntArray(1)
    if (!EGL14.eglChooseConfig(display, attrs, 0, configs, 0, 1, n, 0) || n[0] == 0) throw IllegalStateException("no EGL config")
    config = configs[0]
    context = EGL14.eglCreateContext(display, config, EGL14.EGL_NO_CONTEXT, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
    checkEgl("context")
    pbuffer = EGL14.eglCreatePbufferSurface(display, config, intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0)
    checkEgl("pbuffer")
    EGL14.eglMakeCurrent(display, pbuffer, pbuffer, context)
  }

  private fun setupProgram() {
    val vs = compile(GLES20.GL_VERTEX_SHADER, VERTEX)
    val fs = compile(GLES20.GL_FRAGMENT_SHADER, FRAGMENT)
    program = GLES20.glCreateProgram()
    GLES20.glAttachShader(program, vs)
    GLES20.glAttachShader(program, fs)
    GLES20.glLinkProgram(program)
    val ok = IntArray(1)
    GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, ok, 0)
    if (ok[0] == 0) throw IllegalStateException("link: " + GLES20.glGetProgramInfoLog(program))
    aPos = GLES20.glGetAttribLocation(program, "aPosition")
    aTex = GLES20.glGetAttribLocation(program, "aTexCoord")
    uTexMatrix = GLES20.glGetUniformLocation(program, "uTexMatrix")
  }

  private fun compile(type: Int, src: String): Int {
    val s = GLES20.glCreateShader(type)
    GLES20.glShaderSource(s, src)
    GLES20.glCompileShader(s)
    val ok = IntArray(1)
    GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0)
    if (ok[0] == 0) throw IllegalStateException("shader: " + GLES20.glGetShaderInfoLog(s))
    return s
  }

  private fun destroySurface(s: EGLSurface) {
    if (s != EGL14.EGL_NO_SURFACE && display != EGL14.EGL_NO_DISPLAY) EGL14.eglDestroySurface(display, s)
  }

  private fun checkEgl(what: String) {
    val e = EGL14.eglGetError()
    if (e != EGL14.EGL_SUCCESS) throw IllegalStateException("EGL error in $what: 0x" + Integer.toHexString(e))
  }

  private fun runOnGlSync(block: () -> Unit) {
    if (Thread.currentThread() == glThread) {
      block()
      return
    }
    var err: Throwable? = null
    val latch = CountDownLatch(1)
    gl.post {
      try {
        block()
      } catch (t: Throwable) {
        err = t
      } finally {
        latch.countDown()
      }
    }
    if (!latch.await(5, TimeUnit.SECONDS)) throw IllegalStateException("GL thread timeout")
    err?.let { throw it }
  }

  companion object {
    private const val TAG = "GameOps.FrameRouter"
    private const val EGL_RECORDABLE_ANDROID = 0x3142

    private const val VERTEX = """
      attribute vec4 aPosition;
      attribute vec4 aTexCoord;
      uniform mat4 uTexMatrix;
      varying vec2 vTex;
      void main() {
        gl_Position = aPosition;
        vTex = (uTexMatrix * aTexCoord).xy;
      }
    """
    private const val FRAGMENT = """
      #extension GL_OES_EGL_image_external : require
      precision mediump float;
      varying vec2 vTex;
      uniform samplerExternalOES sTex;
      void main() {
        gl_FragColor = texture2D(sTex, vTex);
      }
    """

    private fun floatBuffer(a: FloatArray): FloatBuffer =
      ByteBuffer.allocateDirect(a.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(a); position(0) }

    private fun even(v: Long): Int = (v.toInt() / 2 * 2).coerceAtLeast(2)

    /** RGBA_8888 Image → ARGB_8888 Bitmap (Bitmap's native layout is RGBA bytes, so the copy is direct). */
    fun imageToBitmap(img: Image): Bitmap {
      val plane = img.planes[0]
      val pixelStride = plane.pixelStride
      val rowStride = plane.rowStride
      val paddedW = rowStride / pixelStride
      val buf = plane.buffer
      buf.rewind()
      // the last row may be shorter than rowStride → pad so copyPixelsFromBuffer has enough bytes
      val needed = rowStride * img.height
      val src = if (buf.remaining() >= needed) buf else ByteBuffer.allocate(needed).apply { put(buf); rewind() }
      val full = Bitmap.createBitmap(paddedW, img.height, Bitmap.Config.ARGB_8888)
      full.copyPixelsFromBuffer(src)
      if (paddedW == img.width) return full
      val cropped = Bitmap.createBitmap(full, 0, 0, img.width, img.height)
      full.recycle()
      return cropped
    }
  }
}
