import { useEffect, useRef, useState } from "react";

/**
 * Detects whether an element's content is visually clipped (overflowing).
 *
 * Attach the returned `ref` to the element whose root you control. Pass a
 * `selector` when the node that actually clips its text is a descendant rather
 * than the root — for example, Mantine's Badge clips its inner
 * ".mantine-Badge-label" instead of the badge root element.
 */
export function useIsTruncated<T extends HTMLElement = HTMLElement>(selector?: string) {
    const ref = useRef<T>(null);
    const [isTruncated, setIsTruncated] = useState(false);

    useEffect(() => {
        const root = ref.current;
        if (!root) return;
        const target = (selector ? root.querySelector<HTMLElement>(selector) : null) ?? root;

        const check = () => {
            setIsTruncated(
                target.scrollWidth > target.clientWidth || target.scrollHeight > target.clientHeight
            );
        };

        check();
        const observer = new ResizeObserver(check);
        observer.observe(target);
        return () => observer.disconnect();
    }, [selector]);

    return { ref, isTruncated };
}
