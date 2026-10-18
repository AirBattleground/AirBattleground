package com.sevenxen.gameops.detector

import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import javax.imageio.IIOImage
import javax.imageio.ImageIO
import javax.imageio.ImageWriteParam
import kotlin.math.max
import kotlin.math.min

/** An ARGB frame as the phone hands it to the detector. */
class Frame(val argb: IntArray, val w: Int, val h: Int) {
    fun toImage(): BufferedImage {
        val img = BufferedImage(w, h, BufferedImage.TYPE_INT_RGB)
        img.setRGB(0, 0, w, h, argb, 0, w)
        return img
    }

    fun crop(x: Int, y: Int, cw: Int, ch: Int): Frame {
        val out = IntArray(cw * ch)
        for (yy in 0 until ch) System.arraycopy(argb, (y + yy) * w + x, out, yy * cw, cw)
        return Frame(out, cw, ch)
    }

    fun rotate90(): Frame {
        val out = IntArray(w * h)
        for (y in 0 until h) for (x in 0 until w) out[x * h + (h - 1 - y)] = argb[y * w + x]
        return Frame(out, h, w)
    }

    fun rotate180(): Frame = Frame(argb.reversedArray(), w, h)

    fun flipH(): Frame {
        val out = IntArray(w * h)
        for (y in 0 until h) for (x in 0 until w) out[y * w + (w - 1 - x)] = argb[y * w + x]
        return Frame(out, w, h)
    }
}

data class Labelled(val group: String, val file: File, val kind: String) {
    val name: String get() = "$group/${file.name}"
}

object TestImages {
    val repoRoot: File = File(System.getProperty("repoRoot") ?: "../..").canonicalFile
    val datasetDir = File(repoRoot, "datasets/bgmi-screenshots")
    const val PHONE_W = 640

    private val entry = Regex("\"file\"\\s*:\\s*\"([^\"]+)\"\\s*,\\s*\"kind\"\\s*:\\s*\"([^\"]+)\"")

    /** Every labelled screenshot: real/ (group "real") and testingss/gXX/. */
    fun labelled(): List<Labelled> {
        val out = ArrayList<Labelled>()
        val dirs = listOf(File(datasetDir, "real")) +
            (File(datasetDir, "testingss").listFiles { f -> f.isDirectory }?.sortedBy { it.name } ?: emptyList())
        for (d in dirs) {
            val labels = File(d, "labels.json")
            if (!labels.exists()) continue
            for (m in entry.findAll(labels.readText())) {
                out += Labelled(d.name, File(d, m.groupValues[1]), m.groupValues[2])
            }
        }
        return out
    }

    fun read(f: File): BufferedImage = ImageIO.read(f) ?: error("cannot decode $f")

    fun argbOf(img: BufferedImage): Frame {
        val w = img.width; val h = img.height
        return Frame(img.getRGB(0, 0, w, h, null, 0, w), w, h)
    }

    /** Area-average downscale to [tw] px wide (what MediaProjection -> ImageReader at 640 px gives). */
    fun downscale(src: Frame, tw: Int = PHONE_W): Frame {
        if (src.w <= tw) return src
        val th = max(1, Math.round(src.h.toDouble() * tw / src.w).toInt())
        val out = IntArray(tw * th)
        for (y in 0 until th) {
            val sy0 = y * src.h / th; val sy1 = max(sy0 + 1, (y + 1) * src.h / th)
            for (x in 0 until tw) {
                val sx0 = x * src.w / tw; val sx1 = max(sx0 + 1, (x + 1) * src.w / tw)
                var r = 0L; var g = 0L; var b = 0L; var n = 0
                for (yy in sy0 until min(sy1, src.h)) {
                    var i = yy * src.w + sx0
                    for (xx in sx0 until min(sx1, src.w)) {
                        val p = src.argb[i++]
                        r += (p shr 16) and 0xff; g += (p shr 8) and 0xff; b += p and 0xff; n++
                    }
                }
                out[y * tw + x] = (0xff shl 24) or ((r / n).toInt() shl 16) or ((g / n).toInt() shl 8) or (b / n).toInt()
            }
        }
        return Frame(out, tw, th)
    }

    fun load640(f: File): Frame = downscale(argbOf(read(f)))

    fun jpegRoundTrip(fr: Frame, quality: Float): Frame {
        val writer = ImageIO.getImageWritersByFormatName("jpeg").next()
        val bos = ByteArrayOutputStream()
        ImageIO.createImageOutputStream(bos).use { ios ->
            writer.output = ios
            val p = writer.defaultWriteParam
            p.compressionMode = ImageWriteParam.MODE_EXPLICIT
            p.compressionQuality = quality
            writer.write(null, IIOImage(fr.toImage(), null, null), p)
        }
        writer.dispose()
        return argbOf(ImageIO.read(ByteArrayInputStream(bos.toByteArray())))
    }

    fun solid(w: Int, h: Int, rgb: Int) = Frame(IntArray(w * h) { (0xff shl 24) or rgb }, w, h)
}
