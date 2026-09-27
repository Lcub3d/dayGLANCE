package com.dayglance.app.widget

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * The widget picker inflates each provider's `android:previewLayout` as
 * RemoteViews with no binder behind it. A preview that points at a live
 * layout shows an empty card or placeholder text, and a collection view
 * renders nothing at all, so every declared preview must be a static,
 * parseable layout whose text resolves.
 */
class WidgetPreviewLayoutsTest {

    private val androidNs = "http://schemas.android.com/apk/res/android"
    private val collectionViews = setOf("ListView", "GridView", "StackView", "AdapterViewFlipper")

    private fun parse(file: File) = DocumentBuilderFactory.newInstance()
        .apply { isNamespaceAware = true }
        .newDocumentBuilder()
        .parse(file)

    private val defaultStrings: Set<String> by lazy {
        File("src/main/res/values").listFiles()!!
            .filter { it.name.endsWith(".xml") }
            .flatMap { f ->
                val nodes = parse(f).getElementsByTagName("string")
                (0 until nodes.length).map { (nodes.item(it) as Element).getAttribute("name") }
            }
            .toSet()
    }

    private fun previewLayouts(): List<Pair<String, String>> =
        File("src/main/res/xml").listFiles()!!
            .filter { it.name.endsWith(".xml") }
            .mapNotNull { info ->
                val root = parse(info).documentElement
                if (root.tagName != "appwidget-provider") return@mapNotNull null
                val preview = root.getAttributeNS(androidNs, "previewLayout")
                if (preview.isEmpty()) null else info.name to preview
            }

    @Test fun `the four agenda-style widgets declare a preview layout`() {
        val declared = previewLayouts().toMap()
        for (info in listOf("widget_info.xml", "widget_upnext_info.xml", "widget_project_info.xml", "widget_goal_info.xml")) {
            val ref = declared[info]
            assertTrue("$info declares no previewLayout", ref != null)
            val initial = parse(File("src/main/res/xml/$info")).documentElement.getAttributeNS(androidNs, "initialLayout")
            assertFalse("$info previews its live layout $initial", ref == initial)
        }
    }

    @Test fun `every preview layout exists, parses, is static, and its strings resolve`() {
        val previews = previewLayouts()
        assertTrue("no widget declares a previewLayout", previews.isNotEmpty())
        for ((info, ref) in previews) {
            assertTrue("$info: previewLayout $ref is not a @layout/ reference", ref.startsWith("@layout/"))
            val file = File("src/main/res/layout/${ref.removePrefix("@layout/")}.xml")
            assertTrue("$info: $file does not exist", file.isFile)

            val doc = parse(file)
            val all = doc.getElementsByTagName("*")
            for (i in 0 until all.length) {
                val el = all.item(i) as Element
                assertFalse("$info: ${file.name} contains a ${el.tagName}, which renders empty in a preview",
                    el.tagName.substringAfterLast('.') in collectionViews)
            }

            val text = file.readText()
            for (m in Regex("@string/([A-Za-z0-9_]+)").findAll(text)) {
                val name = m.groupValues[1]
                assertTrue("$info: ${file.name} references missing @string/$name", name in defaultStrings)
            }
        }
    }
}
