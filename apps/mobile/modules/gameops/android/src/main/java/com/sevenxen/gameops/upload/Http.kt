package com.sevenxen.gameops.upload

import okhttp3.OkHttpClient
import okhttp3.Response
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object Http {
  val client: OkHttpClient by lazy {
    OkHttpClient.Builder()
      .connectTimeout(15, TimeUnit.SECONDS)
      .readTimeout(60, TimeUnit.SECONDS)
      .writeTimeout(120, TimeUnit.SECONDS)
      .retryOnConnectionFailure(true)
      .build()
  }

  /** Throws [HttpStatusException] with the API's {error:{code,message}} when the response isn't 2xx. */
  fun ensureOk(res: Response, bodyText: String?): Unit {
    if (res.isSuccessful) return
    var code: String? = null
    var msg = "HTTP ${res.code}"
    try {
      val err = JSONObject(bodyText ?: "").optJSONObject("error")
      if (err != null) {
        code = err.optString("code").takeIf { it.isNotEmpty() }
        msg = err.optString("message").takeIf { it.isNotEmpty() } ?: msg
      }
    } catch (_: Exception) {
    }
    if (res.code == 401) msg = "Session expired — sign in to 7XEN again ($msg)"
    throw HttpStatusException(res.code, code, msg)
  }
}
