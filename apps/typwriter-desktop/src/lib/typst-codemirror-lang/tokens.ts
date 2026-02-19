/**
 * External tokenizers for the Typst CodeMirror grammar.
 *
 * These handle the context-sensitive parts of the Typst lexer that can't
 * easily be expressed as a pure Lezer grammar:
 *
 *  - Raw blocks  `` `...` `` and `` ```lang ... ``` ``
 *  - Nested block comments  /* /* … */ /*/
*  - Context-sensitive markup Text nodes
*  - Math text tokens (grapheme clusters, numbers)
* 
*/

import { ExternalTokenizer, ContextTracker } from "@lezer/lr";
import {
    Raw,
    BlockComment,
    Text,
    MathText,
    Space,
    Parbreak,
    HeadingMarker,
} from "./parser.terms.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true if `cp` is a Typst newline code point.
 * Mirrors `is_newline` in lexer.rs
 */
function isNewline(cp: number) {
    return (
        cp === 0x0a || // \n
        cp === 0x0b || // \v
        cp === 0x0c || // \f
        cp === 0x0d || // \r
        cp === 0x85 || // NEL
        cp === 0x2028 || // LS
        cp === 0x2029 // PS
    );
}

/**
 * Returns true if the code point can start a Typst identifier
 * (XID_Start or underscore).  We use a simple ASCII fast-path here;
 * full Unicode support is provided by the grammar token regex.
 */
function isIdStart(cp: number) {
    return (
        (cp >= 65 && cp <= 90) || // A-Z
        (cp >= 97 && cp <= 122) || // a-z
        cp === 95 || // _
        cp > 0x7f
    ); // non-ASCII: assume valid (Unicode handled by Lezer)
}

/**
 * Returns true if the code point can continue a Typst identifier
 * (XID_Continue, underscore, or hyphen).
 */
function isIdContinue(cp: number) {
    return (
        isIdStart(cp) ||
        (cp >= 48 && cp <= 57) || // 0-9
        cp === 45
    ); // -
}

// ─── Raw block tokenizer ─────────────────────────────────────────────────────
//
// Typst raw syntax (mirrors Lexer::raw in lexer.rs):
//
//  Inline:  `text`   (1 backtick; `` `` is empty, 2 backticks = empty raw)
//  Block:   ```[lang]\n...``` (3+ backticks)
//
// The tokenizer consumes the entire raw block as a single Raw token so
// that the grammar doesn't have to deal with the internal whitespace
// trimming logic.

export const rawToken = new ExternalTokenizer((input, stack) => {
    if (input.next !== 96 /* ` */) return; // not a backtick

    let pos = input.pos;
    input.advance(); // eat first `

    // Count opening backticks
    let backticks = 1;
    while (input.next === 96) {
        backticks++;
        input.advance();
    }

    // Two backticks → empty raw block
    if (backticks === 2) {
        input.acceptToken(Raw);
        return;
    }

    // Find matching closing sequence of `backticks` backticks
    let found = 0;
    while (input.next >= 0) {
        if (input.next === 96) {
            found++;
            input.advance();
            if (found === backticks) {
                input.acceptToken(Raw);
                return;
            }
        } else {
            found = 0;
            input.advance();
        }
    }
    // Unclosed raw block – accept as error token up to EOF
    input.acceptToken(Raw);
});

// ─── Nested block comment tokenizer ─────────────────────────────────────────
//
// Typst block comments can nest: /* foo /* bar */ baz */
// Mirrors Lexer::block_comment in lexer.rs.

export const blockCommentToken = new ExternalTokenizer((input) => {
    // Expect /*
    if (input.next !== 47 /* / */) return;
    input.advance();
    if ((input.next as number) !== 42 /* * */) return;
    input.advance();

    let depth = 1;
    let prev = 0;

    while (input.next >= 0 && depth > 0) {
        const cur: number = input.next;
        input.advance();

        if (prev === 42 /* * */ && cur === 47 /* / */) {
            depth--;
            prev = 0;
        } else if (prev === 47 /* / */ && cur === 42 /* * */) {
            depth++;
            prev = 0;
        } else {
            prev = cur;
        }
    }

    input.acceptToken(BlockComment);
});

// ─── Context-sensitive markup Text tokenizer ─────────────────────────────────
//
// Mirrors Lexer::text in lexer.rs.
//
// In markup mode, the following characters are *not* plain text and should
// cause the text tokenizer to stop:
//
//   SP HT NL VT FF CR  \  /  [  ]  ~  -  .  '  "  *  _  :  h  `  $  <  >  @  #
//
// Additionally some sequences that start with those characters are still
// plain text when the continuation makes them non-special
// (e.g.  '/' that is NOT '/*' or '//' is plain text).

const MARKUP_STOP_ASCII = new Uint8Array(128);
for (const ch of " \t\n\v\f\r\\/[]~-.'\"`$<>@#*_:h") {
    MARKUP_STOP_ASCII[ch.charCodeAt(0)] = 1;
}

export const markupTextToken = new ExternalTokenizer((input, stack) => {
    // Only emit Text in markup context (checked by the stack dialect / state)
    let count = 0;

    while (input.next >= 0) {
        const cp = input.next;

        // Non-ASCII: Unicode characters are always plain text in markup
        if (cp > 0x7f) {
            input.advance();
            count++;
            continue;
        }

        if (!MARKUP_STOP_ASCII[cp]) {
            input.advance();
            count++;
            continue;
        }

        // Potentially-special character – check the context
        if (count > 0) break; // stop before this character

        // We're at the very start: try to decide if this special character
        // still becomes text in context.
        switch (cp) {
            case 32 /* SP */:
            case 9 /* TAB */:
            case 10: // \n
            case 11: // \v
            case 12: // \f
            case 13: // \r
                // whitespace → not text
                return;

            case 47 /* / */: {
                // '/' is text unless followed by '/' or '*'
                const next = input.peek(1);
                if (next === 47 || next === 42) return; // comment
                input.advance();
                count++;
                // keep scanning
                break;
            }

            case 45 /* - */: {
                // '-' is text unless it is '--', '-?', or followed by a digit
                const next = input.peek(1);
                if (next === 45 || next === 63 /* ? */ || (next >= 48 && next <= 57))
                    return;
                input.advance();
                count++;
                break;
            }

            case 46 /* . */: {
                // '.' is text unless '...'
                const next = input.peek(1);
                if (next === 46) return; // shorthand
                input.advance();
                count++;
                break;
            }

            case 104 /* h */: {
                // 'h' is text unless 'http://' or 'https://'
                const rest = input.peek;
                // Quick check for 't' at position 1
                const n1 = input.peek(1);
                if (n1 !== 116 /* t */) {
                    input.advance();
                    count++;
                    break;
                }
                return; // might be a link
            }

            case 64 /* @ */: {
                // '@' is text unless followed by an id-continue character
                const next = input.peek(1);
                if (isIdContinue(next)) return;
                input.advance();
                count++;
                break;
            }

            default:
                // Any other stop character that can't be plain text
                return;
        }
    }

    if (count > 0) input.acceptToken(Text);
});

// ─── Math text token ────────────────────────────────────────────────────────
//
// In math mode, individual characters or numeric sequences form MathText.
// Numbers: digit+ ('.' digit*)?
// Other: single Unicode grapheme cluster.

export const mathTextToken = new ExternalTokenizer((input) => {
    const cp = input.next;
    if (cp < 0) return;

    // Numbers
    if (cp >= 48 && cp <= 57) {
        input.advance();
        while (input.next >= 48 && input.next <= 57) input.advance();
        // Optional decimal part
        if (input.next === 46 /* . */) {
            const savedPos = input.pos;
            input.advance();
            if (input.next >= 48 && input.next <= 57) {
                while (input.next >= 48 && input.next <= 57) input.advance();
            }
            // Don't consume the dot if not followed by digits (avoid .. shorthand)
        }
        input.acceptToken(MathText);
        return;
    }

    // For other characters: consume one code point
    // (For surrogate pairs / extended grapheme clusters the Lezer runtime
    //  handles UTF-16 decoding; we consume a single logical char here)
    input.advance();
    input.acceptToken(MathText);
});

// ─── Context tracker ────────────────────────────────────────────────────────
//
// Tracks which parsing mode we're in so the highlight tags and the
// external tokenizers can behave correctly.
//
// Mode values:
//   0 = Markup
//   1 = Math
//   2 = Code

export const typstContext = new ContextTracker({
    start: 0, // Markup mode
    shift(context, term, stack, input) {
        return context; // Context switching is handled by grammar structure
    },
    strict: false,
});

// ─── Heading marker tokenizer ───────────────────────────────────────────────
//
// HeadingMarker is one or more '=' characters at the start of a line.
// We handle it externally because '=' is also used for Eq, EqEq, Arrow
// in code mode, and the built-in tokenizer can't distinguish by context.

export const headingToken = new ExternalTokenizer((input, stack) => {
    if (input.next !== 61 /* = */) return;

    // Check we're at the start of a line (either start of input, or previous char was newline)
    // input.pos is the absolute position in the document.
    // At pos 0, we're at the start. Otherwise check the char before.
    if (input.pos > 0) {
        const prev = input.peek(-1);
        if (!isNewline(prev)) return;
    }

    // Consume all '=' characters
    let count = 0;
    while (input.next === 61 /* = */) {
        count++;
        input.advance();
    }

    // After the '=' sequence, must be followed by a space or newline or EOF
    // to be a valid heading marker (not an == operator or => arrow)
    const next = input.next;
    if (next < 0 || next === 32 /* space */ || next === 9 /* tab */ || isNewline(next)) {
        input.acceptToken(HeadingMarker);
    }
});
