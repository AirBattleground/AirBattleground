package com.sevenxen.gameops.upload

/** Server's UploadState (packages/shared/src/phase4.ts). */
data class UploadState(val offset: Long, val sizeBytes: Long, val chunkSize: Long, val complete: Boolean)

sealed class PatchResult {
  data class Ok(val state: UploadState) : PatchResult()
  /** 409 OFFSET_MISMATCH; [realOffset] when the server told us (header / body), else null → HEAD. */
  data class OffsetMismatch(val realOffset: Long?) : PatchResult()
}

class HttpStatusException(val status: Int, val code: String?, message: String) : Exception(message) {
  /** 5xx, 408 and 429 are worth retrying; other 4xx are not (bad token, recording gone, …). */
  val retryable: Boolean get() = status >= 500 || status == 408 || status == 429
}

/** Transport for the tus-like protocol under /api/manager/recordings/:id/upload (OkHttp in the app, fakes in tests). */
interface UploadTransport {
  /** POST …/upload {sizeBytes, mimeType, width?, height?} — idempotent, returns current state. */
  fun create(sizeBytes: Long): UploadState
  /** HEAD …/upload → Upload-Offset. */
  fun head(): Long
  /** PATCH …/upload with Upload-Offset: [offset] and [length] bytes of [data]. */
  fun patch(offset: Long, data: ByteArray, length: Int): PatchResult
  /** POST …/upload/complete. */
  fun complete()
}

/**
 * Resumable chunked upload loop (pure logic). Resumes from whatever offset the server reports, so it survives
 * app restarts, worker retries and lost responses (a PATCH that reached the server but whose response was lost
 * shows up as 409 OFFSET_MISMATCH next time and we jump to the real offset).
 */
class ResumableUploadCore(
  private val transport: UploadTransport,
  private val sizeBytes: Long,
  /** read up to [len] bytes of the file at [fileOffset] into buffer[bufOffset…], returns bytes read (≤0 = EOF) */
  private val read: (fileOffset: Long, buffer: ByteArray, bufOffset: Int, len: Int) -> Int,
  private val defaultChunk: Long = 8L * 1024 * 1024,
  private val maxChunk: Long = 16L * 1024 * 1024,
  private val maxMismatchesInARow: Int = 5,
  private val progress: (uploaded: Long, total: Long) -> Unit = { _, _ -> },
  private val isStopped: () -> Boolean = { false },
) {
  enum class Outcome { DONE, STOPPED }

  class UploadProtocolException(message: String) : Exception(message)

  fun run(): Outcome {
    val initial = transport.create(sizeBytes)
    if (initial.sizeBytes != sizeBytes) throw UploadProtocolException("Server expects ${initial.sizeBytes} bytes, file has $sizeBytes")
    var offset = initial.offset
    checkOffset(offset)
    val chunk = (if (initial.chunkSize > 0) initial.chunkSize else defaultChunk).coerceIn(64L * 1024, maxChunk)
    val buffer = ByteArray(chunk.toInt())
    progress(offset, sizeBytes)

    if (!initial.complete) {
      var mismatches = 0
      while (offset < sizeBytes) {
        if (isStopped()) return Outcome.STOPPED
        val want = minOf(chunk, sizeBytes - offset).toInt()
        val n = readFully(offset, buffer, want)
        if (n != want) throw UploadProtocolException("File changed on disk (read $n of $want bytes at $offset)")
        when (val r = transport.patch(offset, buffer, n)) {
          is PatchResult.Ok -> {
            val next = r.state.offset
            if (next <= offset) {
              // The server did not advance — resync instead of looping forever.
              mismatches++
              offset = transport.head()
            } else {
              mismatches = 0
              offset = next
            }
          }
          is PatchResult.OffsetMismatch -> {
            mismatches++
            offset = r.realOffset ?: transport.head()
          }
        }
        if (mismatches > maxMismatchesInARow) throw UploadProtocolException("Upload offset keeps changing on the server")
        checkOffset(offset)
        progress(offset, sizeBytes)
      }
    }
    if (isStopped()) return Outcome.STOPPED
    transport.complete()
    progress(sizeBytes, sizeBytes)
    return Outcome.DONE
  }

  private fun checkOffset(o: Long) {
    if (o < 0 || o > sizeBytes) throw UploadProtocolException("Server offset $o outside 0..$sizeBytes")
  }

  private fun readFully(offset: Long, buffer: ByteArray, len: Int): Int {
    var total = 0
    while (total < len) {
      val n = read(offset + total, buffer, total, len - total)
      if (n <= 0) return total
      total += n
    }
    return total
  }
}
