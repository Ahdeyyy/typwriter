import type { Attachment } from 'svelte/attachments';

/**
 * Plays the `[data-reveal-item]` entrance inside the element once, the first
 * time it scrolls into view (styles in `routes/layout.css`). Anything already
 * on screen at mount is left alone, so it never flashes out and back in, and
 * the prerendered page stays fully visible without JavaScript.
 */
export const reveal: Attachment<HTMLElement> = (node) => {
	if (node.getBoundingClientRect().top < window.innerHeight) return;

	node.dataset.reveal = 'hidden';
	const observer = new IntersectionObserver(
		(entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			node.dataset.reveal = 'shown';
			observer.disconnect();
		},
		{ rootMargin: '0px 0px -10% 0px' }
	);
	observer.observe(node);
	return () => observer.disconnect();
};
