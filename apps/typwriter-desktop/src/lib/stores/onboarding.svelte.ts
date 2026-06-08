import { okAsync, ResultAsync } from 'neverthrow';
import {
    getOnboardingCompleted,
    openFolder,
    prepareOnboardingWorkspace,
    setMainFile,
    setOnboardingCompleted,
    triggerPreview,
    updateFileContent,
} from '$lib/ipc/commands';
import { preview } from './preview.svelte';
import { workspace } from './workspace.svelte';
import { page } from './page.svelte';
import { normalize } from '$lib/paths';
import { logError } from '$lib/logger';

/** Debounce for the typing → shadow-write → recompile path. Small enough to
 *  feel live, large enough to coalesce same-burst keystrokes into one IPC. */
const TYPING_PREVIEW_INTERVAL = 150;

export interface OnboardingStep {
    id: string;
    title: string;
    /** One or two short sentences introducing the concept. */
    blurb: string;
    /** Key syntax points, rendered as a compact list. */
    bullets?: string[];
    /** A concrete "now you try" nudge tied to the example. */
    tryThis?: string;
    /** Starter Typst the editor is seeded with when the step is first shown. */
    example: string;
}

/** Tracks the "Writing in Typst" tutorial: markup, headings, emphasis, lists,
 *  math, and the `#` function syntax — then points at the full docs. */
export const ONBOARDING_STEPS: OnboardingStep[] = [
    {
        id: 'welcome',
        title: 'Welcome to Typst',
        blurb:
            'Typst turns plain text you type on the left into a typeset document on the right. Try editing the text — the preview updates as you go.',
        bullets: [
            'The left pane is the editor — exactly the one you write documents in.',
            'The right pane is a live preview of the compiled page.',
        ],
        tryThis: 'Change the heading text and watch the page update.',
        example: `= Welcome to Typst

Typst turns *plain text* into a beautifully typeset
document. Edit the text on the left and watch the
page on the right update instantly.
`,
    },
    {
        id: 'headings',
        title: 'Headings & paragraphs',
        blurb:
            'Start a line with one or more equals signs to make a heading. Leave a blank line between blocks of text to start a new paragraph.',
        bullets: [
            '`=` is a top-level heading, `==` a section, `===` a subsection.',
            'A blank line separates paragraphs.',
        ],
        tryThis: 'Add a `=== Subsection` and a second paragraph below it.',
        example: `= Top-level heading
== A section
=== A subsection

Leave a blank line between blocks of text and Typst
starts a new paragraph.

This is the second paragraph.
`,
    },
    {
        id: 'emphasis',
        title: 'Bold & italic',
        blurb:
            'Wrap text in stars for bold, or underscores for italic. You can combine them for extra emphasis.',
        bullets: [
            '`*bold*` makes text bold.',
            '`_italic_` makes text italic.',
        ],
        tryThis: 'Make your own name bold somewhere in the text.',
        example: `You can make text *bold* with stars, and _italic_
with underscores.

You can even *_combine both_* when you really mean it.
`,
    },
    {
        id: 'lists',
        title: 'Lists',
        blurb:
            'Begin lines with a hyphen for a bullet list, or a plus for a numbered list. Indent to nest items.',
        bullets: [
            '`-` starts a bullet list item.',
            '`+` starts a numbered list item.',
        ],
        tryThis: 'Add a third step to the numbered list.',
        example: `Shopping list:

- Apples
- Bread
- Cheese

Recipe:

+ Preheat the oven
+ Mix the dough
`,
    },
    {
        id: 'math',
        title: 'Math',
        blurb:
            'Surround math with dollar signs. Keep it on the line for inline math, or give it space for a centered block equation.',
        bullets: [
            '`$a^2$` renders inline within a sentence.',
            '`$ ... $` with spaces becomes a centered block.',
        ],
        tryThis: 'Change an exponent and watch the equation re-render.',
        example: `Inline math like $a^2 + b^2 = c^2$ flows with the text.

Block math gets its own centered line:

$ sum_(i=1)^n i = (n (n + 1)) / 2 $
`,
    },
    {
        id: 'functions',
        title: 'Functions & the #',
        blurb:
            'Markup is for writing prose. To call a function, switch to code with a leading #. Functions cover everything from coloured text to images and filler.',
        bullets: [
            '`#` switches from markup into code.',
            '`#text(fill: blue)[…]` styles the bracketed content.',
            '`#lorem(n)` inserts n words of placeholder text.',
        ],
        tryThis: 'Change the fill colour to `red`, or the word count in #lorem.',
        example: `Markup is for writing; the \\#-prefix calls a function.

#text(fill: blue)[This sentence is blue.]

Need filler text while you draft? #lorem(20)
`,
    },
    {
        id: 'features',
        title: 'Beyond writing',
        blurb:
            'The editor does more than typeset. Once a document takes shape, you can review it on a second screen, present it, or export it to share.',
        bullets: [
            'Pop the preview out into its own window — handy for a second monitor.',
            'Enter presentation mode to show the document full-screen.',
            'Export to PDF, PNG, or SVG from the preview toolbar.',
        ],
        tryThis: 'Find the export button in the preview toolbar and save this page as a PDF.',
        example: `= Sharing your work

Once a document is ready, Typwriter helps you take it
further:

- View the preview in a separate window
- Present it full-screen
- Export to *PDF*, *PNG*, or *SVG*
`,
    },
    {
        id: 'done',
        title: "You're ready",
        blurb:
            'That covers the essentials: headings, emphasis, lists, math, and functions. The full documentation goes much further — templates, set rules, packages, and more.',
        bullets: [
            'Open the documentation to keep learning.',
            'Or jump straight into writing your first document.',
        ],
        example: `= You're ready!

You now know the basics of Typst — headings,
emphasis, lists, math, and functions.

Open the docs to keep going, or start writing your
first real document.
`,
    },
];

class OnboardingStore {
    /** Index of the currently shown step. */
    stepIndex = $state(0);
    /** True once the scratch workspace is open and the first step is rendered. */
    ready = $state(false);
    /** Bumped on step change / reset so the minimal editor reseeds its document
     *  from the active buffer. Plain typing does NOT bump this — the editor is
     *  the source of truth then. */
    seedVersion = $state(0);
    /** Set the moment the tutorial is finished/skipped this session. Guards the
     *  in-session auto-show against a stale/failed persistence round-trip: the
     *  store write can fail (e.g. disk full) and read back `false`, which would
     *  otherwise bounce the user straight back into the tutorial after they exit. */
    private sessionDismissed = false;

    readonly steps = ONBOARDING_STEPS;

    /** Absolute path of the opened scratch workspace. */
    private rootPath = '';
    /** Per-step editor content, seeded from each step's example and preserved
     *  as the user navigates within a session (decision: edits are kept). */
    private buffers: string[] = $state([]);
    /** Debounce handle for the typing → recompile path. */
    private previewTimer: ReturnType<typeof setTimeout> | null = null;

    current = $derived(this.steps[this.stepIndex]);
    isFirst = $derived(this.stepIndex === 0);
    isLast = $derived(this.stepIndex === this.steps.length - 1);
    /** Completion fraction (0–1) for a progress affordance. */
    progress = $derived((this.stepIndex + 1) / this.steps.length);

    /** Live content of the active step — what the minimal editor seeds from. */
    activeContent = $derived(this.buffers[this.stepIndex] ?? '');

    /** Each step is its own `*.typ` file, named by the step id. This is the
     *  workspace-relative path `set_main_file` expects. */
    private stepRelPath(index: number): string {
        return `${this.steps[index].id}.typ`;
    }

    /** Absolute path, as `update_file_content` (shadow write) expects. */
    private stepAbsPath(index: number): string {
        return `${this.rootPath}/${this.stepRelPath(index)}`;
    }

    /** Open the scratch workspace and render the first step. */
    enter(): ResultAsync<void, string> {
        return ResultAsync.fromPromise(this._enter(), (err) => String(err));
    }

    private async _enter(): Promise<void> {
        this.ready = false;
        this.stepIndex = 0;
        this.buffers = this.steps.map((step) => step.example);

        const files = this.steps.map((step, i) => ({
            name: this.stepRelPath(i),
            content: this.buffers[i],
        }));
        const dirResult = await prepareOnboardingWorkspace(files);
        if (dirResult.isErr()) throw new Error(dirResult.error);
        this.rootPath = normalize(dirResult.value);

        // Bind the editor world to the scratch dir. Talking to the world
        // directly (no workspace/editor store) keeps the tutorial decoupled
        // from the tabbed editor machinery.
        const openResult = await openFolder(this.rootPath);
        if (openResult.isErr()) throw new Error(openResult.error);

        this.ready = true;
        this.seedVersion += 1;
        // Compile step 0. Because every step is a distinct main file, switching
        // steps compiles a genuinely different document — the preview pipeline
        // can never serve a previous step's cached render for the current one,
        // which is what made the old single-file approach show a stale step.
        this.activateStep();
    }

    next(): void {
        this.goTo(this.stepIndex + 1);
    }

    prev(): void {
        this.goTo(this.stepIndex - 1);
    }

    goTo(index: number): void {
        if (index < 0 || index >= this.steps.length || index === this.stepIndex) {
            return;
        }
        this.stepIndex = index;
        this.seedVersion += 1;
        this.activateStep();
    }

    /** Restore the pristine example for the current step. */
    resetExample(): void {
        this.buffers[this.stepIndex] = this.current.example;
        this.seedVersion += 1;
        this.activateStep();
    }

    /** Editor → store: the user typed. Keep the buffer in sync and schedule a
     *  debounced shadow-write + recompile. */
    handleContentChange(content: string): void {
        this.buffers[this.stepIndex] = content;
        this.scheduleTypingPreview();
    }

    /** Make the current step's file the main file, push its buffer into the
     *  world's shadow, and force a fresh compile. Clearing first removes the
     *  previous step's pages so there's no stale flash while this compiles. */
    private activateStep(): void {
        this.clearTimer();
        const relPath = this.stepRelPath(this.stepIndex);
        const absPath = this.stepAbsPath(this.stepIndex);
        const content = this.buffers[this.stepIndex];
        // Reflect the step's file as the workspace main file so the preview
        // pane recognizes it (its empty-state copy reads `workspace.mainFile`).
        workspace.mainFile = normalize(relPath);
        preview.clear();
        // `set_main_file` wants a workspace-relative path; `update_file_content`
        // (the shadow write) wants the absolute path.
        setMainFile(relPath)
            .andThen(() => updateFileContent(absPath, content))
            .andThen(() => triggerPreview('explicit'))
            .mapErr((err) => logError('onboarding: activate step failed:', err));
    }

    private scheduleTypingPreview(): void {
        if (this.previewTimer) return;
        this.previewTimer = setTimeout(() => {
            this.previewTimer = null;
            const absPath = this.stepAbsPath(this.stepIndex);
            const content = this.buffers[this.stepIndex];
            updateFileContent(absPath, content)
                .andThen(() => triggerPreview('typing'))
                .mapErr((err) => logError('onboarding: typing preview failed:', err));
        }, TYPING_PREVIEW_INTERVAL);
    }

    private clearTimer(): void {
        if (this.previewTimer) {
            clearTimeout(this.previewTimer);
            this.previewTimer = null;
        }
    }

    /** Finish or skip — both mark onboarding as shown and return home. */
    finish(): ResultAsync<void, string> {
        return ResultAsync.fromPromise(this._finish(), (err) => String(err));
    }

    skip(): ResultAsync<void, string> {
        return this.finish();
    }

    private async _finish(): Promise<void> {
        // Mark dismissed up front (synchronously) so the safety-net teardown in
        // the page's onDestroy can't re-trigger a second finish, and so the home
        // screen never re-shows the tutorial this session even if the persisted
        // flag fails to write.
        this.sessionDismissed = true;
        this.clearTimer();
        this.ready = false;
        workspace.mainFile = null;

        const flagResult = await setOnboardingCompleted(true);
        if (flagResult.isErr()) {
            // Non-fatal: worst case the user sees onboarding again next launch.
            logError('onboarding: failed to persist completion flag:', flagResult.error);
        }

        this.stepIndex = 0;
        page.navigate('home');
    }

    /** Whether onboarding should auto-show on launch. Desktop callers gate on
     *  this after fonts are ready. */
    shouldAutoShow(): ResultAsync<boolean, string> {
        if (this.sessionDismissed) return okAsync(false);
        return getOnboardingCompleted().map((completed) => !completed);
    }
}

export const onboarding = new OnboardingStore();
