import ReachPopover, { Position, positionMatchWidth } from '@reach/popover'
import classNames from 'classnames'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import FocusLock from 'react-focus-lock'

import { useKeyboard } from '../../hooks/useKeyboard'
import { useOnClickOutside } from '../../hooks/useOnClickOutside'

interface PopoverProps extends React.HTMLAttributes<HTMLDivElement> {
    target: React.RefObject<HTMLElement>
    positionTarget?: React.RefObject<HTMLElement>
    position?: Position
    isOpen?: boolean
    onVisibilityChange?: (open: boolean) => void
    className?: string
}

/**
 * The Popover component is a wrapper around the Reach Popover component.
 * It should be used to display contextual information and should be triggered through an action (such as a button click).
 *
 * This component an be controlled or uncontrolled. This is determined by the consumer providing the `isOpen` prop.
 * Note: You will likely want to position the Popover differently for your use case. Please see the `position` prop for this.
 */
export const Popover: React.FunctionComponent<PopoverProps> = props => {
    const {
        isOpen,
        target,
        positionTarget = target,
        position = positionMatchWidth,
        children,
        className,
        onVisibilityChange,
        ...otherProps
    } = props

    const isControlledReference = useRef(isOpen !== undefined)
    const popoverReference = useRef<HTMLDivElement>(null)

    // Local popover visibility state is used if popover component is used
    // in stateful controlled mode.
    const [isOpenInternal, setOpenInternalState] = useState(false)
    const isPopoverVisible = isControlledReference.current ? isOpen : isOpenInternal

    const setPopoverVisibility = useCallback(
        (state: boolean): void => {
            if (isControlledReference.current) {
                return onVisibilityChange?.(state)
            }

            setOpenInternalState(state)
        },
        [onVisibilityChange]
    )

    useEffect(() => {
        if (!target.current) {
            return
        }

        const targetElement = target.current
        const handleTargetClick = (): void => {
            setPopoverVisibility(!isPopoverVisible)
        }

        targetElement.addEventListener('click', handleTargetClick)

        return () => targetElement.removeEventListener('click', handleTargetClick)
    }, [isPopoverVisible, target, setPopoverVisibility])

    const handleEscapePress = useCallback(() => {
        setPopoverVisibility(false)
    }, [setPopoverVisibility])

    const handleClickOutside = useCallback(
        (event: Event) => {
            if (!target.current) {
                return
            }

            // Click on target is handled by useEffect hook above
            if (target.current.contains(event.target as Node)) {
                return
            }

            setPopoverVisibility(false)
        },
        [target, setPopoverVisibility]
    )

    // Catch any outside click of popover element
    useOnClickOutside(popoverReference, handleClickOutside)

    // Close popover on escape
    useKeyboard({ detectKeys: ['Escape'] }, handleEscapePress)

    if (!isPopoverVisible) {
        return null
    }

    return (
        <ReachPopover
            ref={popoverReference}
            targetRef={positionTarget}
            position={position}
            className={classNames('d-block dropdown-menu', className)}
            role="dialog"
            {...otherProps}
        >
            <FocusLock returnFocus={true}>{children}</FocusLock>
        </ReachPopover>
    )
}
