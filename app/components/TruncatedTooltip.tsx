import { Tooltip, type TooltipProps } from "@mantine/core";
import { cloneElement, type ReactElement, type Ref } from "react";
import { useIsTruncated } from "./useIsTruncated";

export interface TruncatedTooltipProps extends Omit<TooltipProps, "children"> {
    /**
     * CSS selector for the descendant element that clips its text, used when the
     * clipped node is not the child's root. For example, Mantine's Badge clips
     * its inner ".mantine-Badge-label". Leave undefined when the child clips its
     * own root element (e.g. a Text with `truncate`).
     */
    truncationSelector?: string;
    children: ReactElement<{ ref?: Ref<HTMLElement> }>;
}

/**
 * Wraps a single element and only enables its tooltip when the element's
 * content is actually clipped. The measurement ref is merged with Tooltip's own
 * reference ref (Mantine's Tooltip merges any existing ref on its child).
 */
export function TruncatedTooltip({
    truncationSelector,
    children,
    ...tooltipProps
}: TruncatedTooltipProps) {
    const { ref, isTruncated } = useIsTruncated<HTMLElement>(truncationSelector);

    return (
        <Tooltip {...tooltipProps} disabled={!isTruncated || tooltipProps.disabled}>
            {cloneElement(children, { ref })}
        </Tooltip>
    );
}
