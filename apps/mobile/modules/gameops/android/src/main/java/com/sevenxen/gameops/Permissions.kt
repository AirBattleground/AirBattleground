package com.sevenxen.gameops

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.sevenxen.gameops.automation.AutomationService

object Permissions {
  const val BGMI_PACKAGE = "com.pubg.imobile"

  fun overlay(ctx: Context) = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)

  fun notifications(ctx: Context) = NotificationManagerCompat.from(ctx).areNotificationsEnabled()

  fun batteryOptimizationIgnored(ctx: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
    val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
    return pm.isIgnoringBatteryOptimizations(ctx.packageName)
  }

  fun bgmiInstalled(ctx: Context): Boolean = try {
    if (Build.VERSION.SDK_INT >= 33) ctx.packageManager.getPackageInfo(BGMI_PACKAGE, PackageManager.PackageInfoFlags.of(0))
    else @Suppress("DEPRECATION") ctx.packageManager.getPackageInfo(BGMI_PACKAGE, 0)
    true
  } catch (_: PackageManager.NameNotFoundException) {
    false
  }

  fun all(ctx: Context): Map<String, Any?> = mapOf(
    "overlay" to overlay(ctx),
    "accessibility" to AutomationService.isEnabled(ctx),
    "notifications" to notifications(ctx),
    "batteryOptimizationIgnored" to batteryOptimizationIgnored(ctx),
    "bgmiInstalled" to bgmiInstalled(ctx),
  )

  fun overlaySettingsIntent(ctx: Context): Intent =
    Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

  fun accessibilitySettingsIntent(): Intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

  @Suppress("BatteryLife")
  fun batteryIntent(ctx: Context): Intent =
    Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

  fun launchBgmi(ctx: Context): Boolean {
    val i = ctx.packageManager.getLaunchIntentForPackage(BGMI_PACKAGE) ?: return false
    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
    return try {
      ctx.startActivity(i)
      true
    } catch (_: Throwable) {
      false
    }
  }
}
