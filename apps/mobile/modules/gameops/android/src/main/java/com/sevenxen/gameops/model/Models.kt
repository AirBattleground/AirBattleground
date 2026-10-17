package com.sevenxen.gameops.model

/*
 * Plain-Kotlin models mirroring GameOps.types.ts / packages/shared/src/phase4.ts (RecipeStep).
 * No android.* imports — these are exercised by JVM unit tests.
 * JS values arrive from Expo as Map<String, Any?> / List<Any?> / Double / Boolean / String.
 */

class ContractException(val code: String, message: String) : Exception(message)

/** Fingerprint: 64-bit dHash of a region of the game viewport. region = [x, y, w, h] as 0..1 fractions. */
data class FingerprintSpec(val hash: Long, val region: FloatArray, val maxDistance: Int) {
  fun toMap(): Map<String, Any?> = mapOf(
    "hash" to hashToHex(hash),
    "region" to region.map { it.toDouble() },
    "maxDistance" to maxDistance,
  )

  override fun equals(other: Any?): Boolean =
    other is FingerprintSpec && other.hash == hash && other.maxDistance == maxDistance && other.region.contentEquals(region)

  override fun hashCode(): Int = (hash.hashCode() * 31 + region.contentHashCode()) * 31 + maxDistance

  companion object {
    fun fromMap(m: Map<*, *>): FingerprintSpec {
      val hex = m["hash"] as? String ?: throw ContractException("INVALID_RECIPE", "fingerprint.hash missing")
      return FingerprintSpec(hexToHash(hex), floats4(m["region"], "fingerprint.region"), num(m["maxDistance"])?.toInt() ?: 10)
    }
  }
}

sealed class StepAction {
  abstract fun toMap(): Map<String, Any?>

  data class Tap(val x: Float, val y: Float) : StepAction() {
    override fun toMap() = mapOf("type" to "tap", "x" to x.toDouble(), "y" to y.toDouble())
  }

  data class Swipe(val x: Float, val y: Float, val x2: Float, val y2: Float, val durationMs: Long) : StepAction() {
    override fun toMap() = mapOf(
      "type" to "swipe", "x" to x.toDouble(), "y" to y.toDouble(), "x2" to x2.toDouble(), "y2" to y2.toDouble(), "durationMs" to durationMs,
    )
  }

  data class Wait(val ms: Long) : StepAction() {
    override fun toMap() = mapOf("type" to "wait", "ms" to ms)
  }

  data class InputText(val field: String) : StepAction() {
    override fun toMap() = mapOf("type" to "input_text", "field" to field)
  }

  data class ReadText(val field: String, val region: FloatArray) : StepAction() {
    override fun toMap() = mapOf("type" to "read_text", "field" to field, "region" to region.map { it.toDouble() })
    override fun equals(other: Any?) = other is ReadText && other.field == field && other.region.contentEquals(region)
    override fun hashCode() = field.hashCode() * 31 + region.contentHashCode()
  }

  object Manual : StepAction() {
    override fun toMap() = mapOf("type" to "manual")
    override fun toString() = "Manual"
  }

  companion object {
    fun fromMap(m: Map<*, *>): StepAction = when (val type = m["type"]) {
      "tap" -> Tap(f(m, "x"), f(m, "y"))
      "swipe" -> Swipe(f(m, "x"), f(m, "y"), f(m, "x2"), f(m, "y2"), num(m["durationMs"])?.toLong() ?: 400L)
      "wait" -> Wait(num(m["ms"])?.toLong() ?: 1000L)
      "input_text" -> InputText(m["field"] as? String ?: "roomPassword")
      "read_text" -> ReadText(m["field"] as? String ?: "roomId", floats4(m["region"], "action.region"))
      "manual" -> Manual
      else -> throw ContractException("INVALID_RECIPE", "Unknown recipe action type: $type")
    }

    private fun f(m: Map<*, *>, k: String): Float =
      num(m[k])?.toFloat() ?: throw ContractException("INVALID_RECIPE", "action.$k missing")
  }
}

data class RecipeStepModel(
  val id: String,
  val label: String,
  val hint: String?,
  val expect: FingerprintSpec?,
  val action: StepAction,
  val timeoutMs: Long,
) {
  fun toMap(): Map<String, Any?> {
    val out = linkedMapOf<String, Any?>("id" to id, "label" to label)
    if (hint != null) out["hint"] = hint
    if (expect != null) out["expect"] = expect.toMap()
    out["action"] = action.toMap()
    out["timeoutMs"] = timeoutMs
    return out
  }

  companion object {
    fun fromMap(m: Map<*, *>): RecipeStepModel {
      val action = m["action"] as? Map<*, *> ?: throw ContractException("INVALID_RECIPE", "step.action missing")
      return RecipeStepModel(
        id = m["id"]?.toString() ?: throw ContractException("INVALID_RECIPE", "step.id missing"),
        label = m["label"]?.toString() ?: "",
        hint = m["hint"] as? String,
        expect = (m["expect"] as? Map<*, *>)?.let { FingerprintSpec.fromMap(it) },
        action = StepAction.fromMap(action),
        timeoutMs = num(m["timeoutMs"])?.toLong() ?: 15000L,
      )
    }
  }
}

data class StartOptions(
  val apiBaseUrl: String,
  val token: String,
  val matchId: String,
  val recordingId: String,
  val title: String,
  val checklist: List<RecipeStepModel>,
  val autoMode: Boolean,
  val recordVideo: Boolean,
  val quality: String,
  val autoCapture: Boolean,
  val roomPassword: String?,
  val launchBgmi: Boolean,
) {
  companion object {
    fun fromMap(m: Map<*, *>): StartOptions {
      fun str(k: String): String = (m[k] as? String)?.takeIf { it.isNotBlank() }
        ?: throw ContractException("INVALID_OPTIONS", "startSession: '$k' is required")
      return StartOptions(
        apiBaseUrl = str("apiBaseUrl").trimEnd('/'),
        token = str("token"),
        matchId = str("matchId"),
        recordingId = str("recordingId"),
        title = (m["title"] as? String) ?: "7XEN live match",
        checklist = (m["checklist"] as? List<*>)?.mapNotNull { (it as? Map<*, *>)?.let(RecipeStepModel::fromMap) } ?: emptyList(),
        autoMode = m["autoMode"] as? Boolean ?: false,
        recordVideo = m["recordVideo"] as? Boolean ?: true,
        quality = if (m["quality"] == "1080p") "1080p" else "720p",
        autoCapture = m["autoCapture"] as? Boolean ?: true,
        roomPassword = (m["roomPassword"] as? String)?.takeIf { it.isNotEmpty() },
        launchBgmi = m["launchBgmi"] as? Boolean ?: false,
      )
    }
  }
}

fun hashToHex(h: Long): String = java.lang.Long.toHexString(h).padStart(16, '0')

fun hexToHash(hex: String): Long {
  val clean = hex.trim().lowercase()
  if (clean.isEmpty() || clean.length > 16 || clean.any { it !in '0'..'9' && it !in 'a'..'f' }) {
    throw ContractException("INVALID_RECIPE", "fingerprint.hash must be 16 hex chars")
  }
  return java.lang.Long.parseUnsignedLong(clean, 16)
}

internal fun num(v: Any?): Number? = when (v) {
  is Number -> v
  is String -> v.toDoubleOrNull()
  else -> null
}

internal fun floats4(v: Any?, what: String): FloatArray {
  val l = v as? List<*> ?: throw ContractException("INVALID_RECIPE", "$what must be [x, y, w, h]")
  if (l.size != 4) throw ContractException("INVALID_RECIPE", "$what must have 4 numbers")
  return FloatArray(4) { num(l[it])?.toFloat() ?: 0f }
}
