package com.sevenxen.gameops

import com.sevenxen.gameops.upload.HttpStatusException
import com.sevenxen.gameops.upload.PatchResult
import com.sevenxen.gameops.upload.ResumableUploadCore
import com.sevenxen.gameops.upload.UploadState
import com.sevenxen.gameops.upload.UploadTransport
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayOutputStream

class ResumableUploadCoreTest {
  /** In-memory server following the phase-4 protocol. */
  private class FakeServer(val size: Long, val chunk: Long = 1000) : UploadTransport {
    val received = ByteArrayOutputStream()
    var offset = 0L
    var completed = false
    var patches = 0
    var heads = 0
    /** hooks to simulate failures */
    var beforePatch: (Long) -> PatchResult? = { null }
    var dropResponseOnce = false

    override fun create(sizeBytes: Long) = UploadState(offset, size, chunk, false)
    override fun head(): Long { heads++; return offset }
    override fun patch(offset: Long, data: ByteArray, length: Int): PatchResult {
      patches++
      beforePatch(offset)?.let { return it }
      if (offset != this.offset) return PatchResult.OffsetMismatch(this.offset)
      received.write(data, 0, length)
      this.offset += length
      if (dropResponseOnce) {
        dropResponseOnce = false
        throw java.io.IOException("connection reset after the server stored the chunk")
      }
      return PatchResult.Ok(UploadState(this.offset, size, chunk, this.offset == size))
    }
    override fun complete() {
      if (offset != size) throw HttpStatusException(409, "OFFSET_MISMATCH", "incomplete")
      completed = true
    }
  }

  private fun file(n: Int) = ByteArray(n) { (it % 251).toByte() }

  private fun core(server: UploadTransport, data: ByteArray, progress: MutableList<Long>? = null, stop: () -> Boolean = { false }) =
    ResumableUploadCore(
      server, data.size.toLong(),
      read = { off, buf, bo, len -> val n = minOf(len, data.size - off.toInt()); System.arraycopy(data, off.toInt(), buf, bo, n); n },
      progress = { up, _ -> progress?.add(up) },
      isStopped = stop,
    )

  @Test
  fun uploadsInServerChunksAndCompletes() {
    val data = file(250_000)
    val s = FakeServer(data.size.toLong(), chunk = 64 * 1024)
    val progress = mutableListOf<Long>()
    assertEquals(ResumableUploadCore.Outcome.DONE, core(s, data, progress).run())
    assertTrue(s.completed)
    assertArrayEquals(data, s.received.toByteArray())
    assertEquals(4, s.patches) // 64K,64K,64K,~53K
    assertEquals(data.size.toLong(), progress.last())
    assertTrue(progress.zipWithNext().all { (a, b) -> b >= a })
  }

  @Test
  fun resumesFromServerOffset() {
    val data = file(200_000)
    val s = FakeServer(data.size.toLong(), chunk = 64 * 1024)
    // first 100k already on the server from a previous run
    s.received.write(data, 0, 100_000)
    s.offset = 100_000
    core(s, data).run()
    assertArrayEquals(data, s.received.toByteArray())
    assertEquals(2, s.patches)
  }

  @Test
  fun offsetMismatchJumpsToRealOffset() {
    val data = file(300_000)
    val s = FakeServer(data.size.toLong(), chunk = 100_000)
    var first = true
    s.beforePatch = { off ->
      if (first && off == 100_000L) {
        first = false
        // another (lost) PATCH already landed: server is at 200k
        s.received.write(data, 100_000, 100_000)
        s.offset = 200_000
        PatchResult.OffsetMismatch(200_000)
      } else null
    }
    core(s, data).run()
    assertArrayEquals(data, s.received.toByteArray())
    assertTrue(s.completed)
  }

  @Test
  fun mismatchWithoutOffsetUsesHead() {
    val data = file(150_000)
    val s = FakeServer(data.size.toLong(), chunk = 100_000)
    var once = true
    s.beforePatch = { _ -> if (once) { once = false; PatchResult.OffsetMismatch(null) } else null }
    core(s, data).run()
    assertEquals(1, s.heads)
    assertArrayEquals(data, s.received.toByteArray())
  }

  @Test
  fun lostResponseIsRecoveredOnNextRun() {
    val data = file(250_000)
    val s = FakeServer(data.size.toLong(), chunk = 100_000)
    s.dropResponseOnce = true
    try {
      core(s, data).run()
      fail("expected IOException")
    } catch (_: java.io.IOException) {
    }
    // worker retry: create() reports 100k, upload continues without duplicating bytes
    core(s, data).run()
    assertArrayEquals(data, s.received.toByteArray())
  }

  @Test
  fun stopsWhenWorkerIsStopped() {
    val data = file(500_000)
    val s = FakeServer(data.size.toLong(), chunk = 100_000)
    var calls = 0
    val out = core(s, data, stop = { calls++ >= 2 }).run()
    assertEquals(ResumableUploadCore.Outcome.STOPPED, out)
    assertEquals(false, s.completed)
    assertEquals(200_000L, s.offset)
  }

  @Test
  fun alreadyCompleteJustFinalizes() {
    val data = file(10_000)
    val s = object : UploadTransport {
      var completed = false
      override fun create(sizeBytes: Long) = UploadState(sizeBytes, sizeBytes, 8_000_000, true)
      override fun head() = 10_000L
      override fun patch(offset: Long, data: ByteArray, length: Int): PatchResult = throw AssertionError("no patch expected")
      override fun complete() { completed = true }
    }
    assertEquals(ResumableUploadCore.Outcome.DONE, core(s, data).run())
    assertTrue(s.completed)
  }

  @Test(expected = ResumableUploadCore.UploadProtocolException::class)
  fun endlessMismatchGivesUp() {
    val data = file(10_000)
    val s = FakeServer(data.size.toLong())
    s.beforePatch = { PatchResult.OffsetMismatch(0) }
    core(s, data).run()
  }

  @Test
  fun retryableStatuses() {
    assertTrue(HttpStatusException(503, null, "").retryable)
    assertTrue(HttpStatusException(429, null, "").retryable)
    assertEquals(false, HttpStatusException(401, null, "").retryable)
    assertEquals(false, HttpStatusException(404, null, "").retryable)
  }
}
