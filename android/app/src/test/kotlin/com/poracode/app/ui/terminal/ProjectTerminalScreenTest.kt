package com.poracode.app.ui.terminal

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProjectTerminalScreenTest {
    @Test
    fun initialActionWaitsForAWatchAndCanOnlySendOnce() {
        assertFalse(shouldSendProjectInitialCommand("pnpm test", false, false, false, false))
        assertFalse(shouldSendProjectInitialCommand("pnpm test", false, true, false, true))
        assertFalse(shouldSendProjectInitialCommand("pnpm test", false, true, true, false))
        assertTrue(shouldSendProjectInitialCommand("pnpm test", false, true, true, true))
        assertFalse(shouldSendProjectInitialCommand("pnpm test", true, true, true, true))
        assertFalse(shouldSendProjectInitialCommand("  ", false, true, true, true))
    }
}
