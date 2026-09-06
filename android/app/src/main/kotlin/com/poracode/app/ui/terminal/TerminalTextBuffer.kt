package com.poracode.app.ui.terminal

data class TerminalRenderedDocument(
    val lines: List<String>,
    /** Same rows as [lines], grouped into style runs for ANSI-colored rendering. */
    val styledLines: List<List<TerminalStyledRun>>,
    val revision: Long,
)

/** Small bounded ANSI/plain terminal projection optimized for append-only cursor transcripts. */
class TerminalTextBuffer(
    private val maxLines: Int = 5_000,
    private val maxLineUtf16Units: Int = 8_192,
) {
    private class Line {
        val text = StringBuilder()
        val styles = mutableListOf<TerminalAnsiStyle>()
    }

    private val lines = mutableListOf(Line())
    private var source = ""
    private var cursorColumn = 0
    private var escape = StringBuilder()
    private var style = TerminalAnsiStyle()
    private var revision = 0L
    private var cachedTerminalDocument: TerminalRenderedDocument? = null

    fun update(transcript: String): TerminalRenderedDocument {
        if (transcript == source) return snapshot()
        if (transcript.startsWith(source)) {
            append(transcript.substring(source.length))
        } else {
            reset()
            append(transcript)
        }
        source = transcript
        revision += 1L
        return snapshot()
    }

    private fun append(value: String) {
        value.forEach(::accept)
        trimLines()
    }

    private fun accept(character: Char) {
        if (escape.isNotEmpty()) {
            escape.append(character)
            val completeCsi = escape.length > 2 && escape[1] == '[' &&
                character.code in 0x40..0x7e
            val unsupportedEscape = escape.length == 2 && escape[1] != '['
            if (escape.length > MAX_ESCAPE_LENGTH || completeCsi || unsupportedEscape) {
                finishEscape()
            }
            return
        }
        when (character) {
            '\u001b' -> escape.append(character)
            '\n' -> newLine()
            '\r' -> cursorColumn = 0
            '\b' -> backspace()
            '\t' -> repeat(TAB_WIDTH - cursorColumn % TAB_WIDTH) { write(' ') }
            else -> if (character >= ' ' && character != '\u007f') write(character)
        }
    }

    private fun finishEscape() {
        val sequence = escape.toString()
        escape = StringBuilder()
        if (!sequence.startsWith("\u001b[")) return
        val command = sequence.lastOrNull() ?: return
        val arguments = sequence.substring(2, sequence.length - 1)
        when (command) {
            'K' -> clearLine(arguments.toIntOrNull() ?: 0)
            'J' -> if ((arguments.toIntOrNull() ?: 0) == 2) clearScreen()
            'G' -> cursorColumn = columnCount(arguments) - 1
            'H', 'f' -> cursorColumn = 0
            'C' -> cursorColumn =
                (cursorColumn + columnCount(arguments)).coerceAtMost(maxLineUtf16Units)
            'D' -> cursorColumn = (cursorColumn - columnCount(arguments)).coerceAtLeast(0)
            'm' -> style = applyTerminalSgr(parseSgrParameters(arguments), style)
            // Unsupported cursor controls are intentionally presentation-only.
            else -> Unit
        }
    }

    /** CSI column argument; omitted means 1, and hostile magnitudes stay inside the line window. */
    private fun columnCount(arguments: String): Int =
        (arguments.toIntOrNull() ?: 1).coerceIn(1, maxLineUtf16Units)

    private fun parseSgrParameters(arguments: String): List<Int> =
        if (arguments.isEmpty()) {
            listOf(0)
        } else {
            arguments.split(';').map { it.toIntOrNull() ?: 0 }
        }

    private fun write(character: Char) {
        val line = lines.last()
        if (cursorColumn < line.text.length) {
            line.text.setCharAt(cursorColumn, character)
            line.styles[cursorColumn] = style
        } else {
            while (line.text.length < cursorColumn) {
                line.text.append(' ')
                line.styles.add(TerminalAnsiStyle())
            }
            line.text.append(character)
            line.styles.add(style)
        }
        cursorColumn += 1
        if (line.text.length > maxLineUtf16Units) {
            val overflow = line.text.length - maxLineUtf16Units
            line.text.delete(0, overflow)
            repeat(overflow) { line.styles.removeAt(0) }
            cursorColumn = line.text.length
        }
    }

    private fun newLine() {
        lines += Line()
        cursorColumn = 0
        trimLines()
    }

    private fun backspace() {
        if (cursorColumn <= 0) return
        cursorColumn -= 1
    }

    private fun clearLine(mode: Int) {
        val line = lines.last()
        when (mode) {
            1 -> {
                val end = (cursorColumn + 1).coerceAtMost(line.text.length)
                if (line.text.isNotEmpty()) {
                    line.text.delete(0, end)
                    repeat(end) { line.styles.removeAt(0) }
                }
            }
            2 -> {
                line.text.clear()
                line.styles.clear()
                cursorColumn = 0
            }
            else -> if (cursorColumn < line.text.length) {
                line.text.delete(cursorColumn, line.text.length)
                while (line.styles.size > cursorColumn) line.styles.removeAt(line.styles.size - 1)
            }
        }
    }

    private fun clearScreen() {
        lines.clear()
        lines += Line()
        cursorColumn = 0
    }

    private fun trimLines() {
        val overflow = lines.size - maxLines
        if (overflow > 0) lines.subList(0, overflow).clear()
    }

    private fun reset() {
        lines.clear()
        lines += Line()
        cursorColumn = 0
        escape = StringBuilder()
        style = TerminalAnsiStyle()
        source = ""
    }

    private fun snapshot(): TerminalRenderedDocument {
        cachedTerminalDocument?.takeIf { it.revision == revision }?.let { return it }
        val document = TerminalRenderedDocument(
            lines = lines.map { it.text.toString() },
            styledLines = lines.map(::styledRuns),
            revision = revision,
        )
        cachedTerminalDocument = document
        return document
    }

    private fun styledRuns(line: Line): List<TerminalStyledRun> {
        if (line.text.isEmpty()) return emptyList()
        val runs = mutableListOf<TerminalStyledRun>()
        var runStart = 0
        for (index in 1..line.text.length) {
            val boundary = index == line.text.length || line.styles[index] != line.styles[runStart]
            if (boundary) {
                runs += TerminalStyledRun(
                    text = line.text.substring(runStart, index),
                    style = line.styles[runStart],
                )
                runStart = index
            }
        }
        return runs
    }

    private companion object {
        const val TAB_WIDTH = 8
        const val MAX_ESCAPE_LENGTH = 64
    }
}
