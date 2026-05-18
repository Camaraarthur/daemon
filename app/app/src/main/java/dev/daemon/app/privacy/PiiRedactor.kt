package dev.daemon.app.privacy

/**
 * v0.1 PII strip — regex-based. Replaces sensitive substrings with stable
 * placeholders before BYOK egress; the provider sees `{{EMAIL_1}}` not
 * `anna@example.com`. The mapping is kept in-memory on the device only;
 * we restore real values in the response before showing the user.
 *
 * v0.2 will swap this for an on-device NER model (Presidio-equivalent).
 * The interface stays the same.
 *
 * Honest scope: this is *pseudonymization*, not anonymization (legally
 * different — placeholders are reversible on this device). Privacy policy
 * is explicit about that.
 */
class PiiRedactor {

    /**
     * Result of [redact]: the redacted text + the mapping needed to
     * [restore] placeholders in the response.
     */
    data class Redacted(
        val text: String,
        val map: Map<String, String>,
    ) {
        val count: Int get() = map.size
    }

    fun redact(input: String): Redacted {
        val map = LinkedHashMap<String, String>()
        var working = input
        var emailCounter = 0
        var phoneCounter = 0
        var ibanCounter = 0
        var ccCounter = 0
        var urlCounter = 0

        // Email — must run before URL because they can overlap on `@`.
        working = EMAIL.replace(working) { mr ->
            emailCounter++
            val token = "{{EMAIL_$emailCounter}}"
            map[token] = mr.value
            token
        }

        // International + national phone numbers, loose match.
        working = PHONE.replace(working) { mr ->
            // Avoid replacing inside already-injected tokens.
            if (mr.value.contains("{{") || mr.value.contains("}}")) mr.value
            else {
                phoneCounter++
                val token = "{{PHONE_$phoneCounter}}"
                map[token] = mr.value
                token
            }
        }

        // IBAN — 2 letters + 2 check digits + up to 30 alphanumerics, grouped.
        working = IBAN.replace(working) { mr ->
            ibanCounter++
            val token = "{{IBAN_$ibanCounter}}"
            map[token] = mr.value
            token
        }

        // Credit card (Luhn check skipped — formatting match only).
        working = CREDIT_CARD.replace(working) { mr ->
            ccCounter++
            val token = "{{CC_$ccCounter}}"
            map[token] = mr.value
            token
        }

        // URLs — drop the query string to avoid leaking tokens but keep host.
        working = URL.replace(working) { mr ->
            urlCounter++
            val token = "{{URL_$urlCounter}}"
            map[token] = mr.value
            token
        }

        return Redacted(working, map)
    }

    fun restore(response: String, map: Map<String, String>): String {
        if (map.isEmpty()) return response
        var working = response
        for ((token, original) in map) {
            working = working.replace(token, original)
        }
        return working
    }

    companion object {
        // Conservative regexes — better to over-redact a bit than under-redact.
        private val EMAIL =
            Regex("""[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}""")
        private val PHONE =
            Regex("""(?<![\w/])\+?\d[\d\s().\-]{7,}\d(?![\w/])""")
        private val IBAN =
            Regex("""\b[A-Z]{2}\d{2}[A-Z0-9 ]{11,30}\b""")
        private val CREDIT_CARD =
            Regex("""\b(?:\d[ \-]?){13,19}\b""")
        private val URL =
            Regex("""\bhttps?://[^\s)<>"']+""")
    }
}
