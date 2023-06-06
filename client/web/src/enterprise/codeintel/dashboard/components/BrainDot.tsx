import React from 'react'

import { mdiBrain } from '@mdi/js'
import classNames from 'classnames'

import { Button, Icon, Link, Tooltip } from '@sourcegraph/wildcard'

import styles from './BrainDot.module.scss'

export interface BrainDotProps {
    repoName: string
}

export const BrainDot: React.FunctionComponent<BrainDotProps> = ({ repoName }) => {
    return (
        <Tooltip content="View code intelligence summary">
            <Link to={`/${repoName}/-/code-graph/dashboard`}>
                <Button className={classNames('text-decoration-none', styles.braindot)} aria-label="Code graph">
                    <Icon aria-hidden={true} svgPath={mdiBrain} />
                </Button>
            </Link>
        </Tooltip>
    )
}
