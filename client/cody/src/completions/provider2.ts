import { parseStringPromise } from 'xml2js'

import { Message } from '@sourcegraph/cody-shared/src/sourcegraph-api'
import { SourcegraphNodeCompletionsClient } from '@sourcegraph/cody-shared/src/sourcegraph-api/completions/nodeClient'

import { Completion } from '.'
import { ReferenceSnippet } from './context'
import { messagesToText } from './prompts'
import { CompletionProvider, batchCompletions } from './provider'

const COMPLETIONS_PREAMBLE = 'You are Cody, a code completion AI developed by Sourcegraph.'

export class NewCompletionProvider implements CompletionProvider {
    constructor(
        protected completionsClient: SourcegraphNodeCompletionsClient,
        protected promptChars: number,
        protected responseTokens: number,
        protected snippets: ReferenceSnippet[],
        protected prefix: string,
        protected suffix: string,
        protected injectPrefix: string,
        protected languageId: string,
        protected defaultN: number = 1
    ) {}

    // Returns the content specific prompt excluding additional referenceSnippets
    private createPromptPrefix(): Message[] {
        // TODO(beyang): escape 'Human:' and 'Assistant:'
        const prefixLines = this.prefix.split('\n')
        if (prefixLines.length === 0) {
            throw new Error('no prefix lines')
        }

        const tail = getTail(this.prefix, false)

        // NEXT: update prompt to have assistant write the prefix
        const prefixMessages: Message[] = [
            {
                speaker: 'human',
                text: COMPLETIONS_PREAMBLE,
            },
            {
                speaker: 'assistant',
                text: 'I am Cody, a code completion AI developed by Sourcegraph.',
            },
            {
                speaker: 'human',
                text: `Only respond with code completions in between tags like this:
<CODE5711>
// Code goes here
</CODE5711>
All answers must be valid ${this.languageId} programs.
Complete the following file:
<CODE5711>
${this.prefix}
</CODE5711>`,
            },
            {
                speaker: 'assistant',
                text: `<CODE5711>
${tail}`,
            },
        ]
        return prefixMessages
    }

    public emptyPromptLength(): number {
        const promptNoSnippets = messagesToText(this.createPromptPrefix())
        return promptNoSnippets.length - 10 // extra 10 chars of buffer cuz who knows
    }

    // Creates the resulting prompt and adds as many snippets from the reference
    // list as possible.
    protected createPrompt(): Message[] {
        const prefixMessages = this.createPromptPrefix()
        const referenceSnippetMessages: Message[] = []

        // let remainingChars = this.promptChars - this.emptyPromptLength()

        // if (this.suffix.length > 0) {
        //     let suffix = ''
        //     // We throw away the first 5 lines of the suffix to avoid the LLM to
        //     // just continue the completion by appending the suffix.
        //     const suffixLines = this.suffix.split('\n')
        //     if (suffixLines.length > 5) {
        //         suffix = suffixLines.slice(5).join('\n')
        //     }

        //     if (suffix.length > 0) {
        //         const suffixContext: Message[] = [
        //             {
        //                 speaker: 'human',
        //                 text:
        //                     'Add the following code snippet to your knowledge base:\n' +
        //                     '```' +
        //                     `\n${suffix}\n` +
        //                     '```',
        //             },
        //             {
        //                 speaker: 'assistant',
        //                 text: '```\n// Ok```',
        //             },
        //         ]

        //         const numSnippetChars = messagesToText(suffixContext).length + 1
        //         if (numSnippetChars <= remainingChars) {
        //             referenceSnippetMessages.push(...suffixContext)
        //             remainingChars -= numSnippetChars
        //         }
        //     }
        // }

        // for (const snippet of this.snippets) {
        //     const snippetMessages: Message[] = [
        //         {
        //             speaker: 'human',
        //             text:
        //                 `Add the following code snippet (from file ${snippet.filename}) to your knowledge base:\n` +
        //                 '```' +
        //                 `\n${snippet.text}\n` +
        //                 '```',
        //         },
        //         {
        //             speaker: 'assistant',
        //             text: 'Okay, I have added it to my knowledge base.',
        //         },
        //     ]
        //     const numSnippetChars = messagesToText(snippetMessages).length + 1
        //     if (numSnippetChars > remainingChars) {
        //         break
        //     }
        //     referenceSnippetMessages.push(...snippetMessages)
        //     remainingChars -= numSnippetChars
        // }

        return [...referenceSnippetMessages, ...prefixMessages]
    }

    private async postProcess(rawResponse: string): Promise<string> {
        console.log('# rawResponse\n', rawResponse)

        let completion = extractFromCodeBlock(rawResponse)
        const completionStart = completion.trimStart()
        const prefixEnd = getTail(this.prefix, true)
        if (prefixEnd !== undefined) {
            const gcp = greatestCommonPrefix(prefixEnd, completionStart)
            if (gcp.trim().length > 0) {
                console.log('trimmed duplicate line', gcp)
                completion = completion.slice(completion.indexOf(gcp) + gcp.length)
            }
        }
        // const firstNonEmptyCompletionLine = completion.split('\n').find(l => l.trim().length > 0)
        // const lastNonEmptyPrefixLine = this.prefix.split('\n').findLast(l => l.trim().length > 0)
        // if (firstNonEmptyCompletionLine !== undefined && lastNonEmptyPrefixLine !== undefined) {
        //     const gcp = greatestCommonPrefix(firstNonEmptyCompletionLine, lastNonEmptyPrefixLine)
        //     if (gcp.trim().length > 0) {
        //         console.log('trimmed duplicate line', gcp)
        //         completion = completion.slice(completion.indexOf(gcp) + gcp.length)
        //     }
        // }

        // const completionLines = completion.trim().split('\n')
        // if (completionLines.length === 0) {
        //     throw new Error('TODO')
        // }
        // if (completionLines.length === 1) {
        //     throw new Error('TODO')
        // }

        // const nakedFirstLine = completionLines[0]
        // const lastLine = this.prefix.trim().split('\n')[-1]

        // // TODO: use this as a completion example
        // // get greatest common prefix of lastLine and nakedFirstLine
        // const trimmedFirstLine = nakedFirstLine.slice(i)
        // if (trimmedFirstLine.trim().length === 0) {
        //     completion = completionLines.slice(1).join('\n')
        // } else {
        //     completion = trimmedFirstLine + '\n' + completionLines.slice(1).join('\n')
        // }
        // completion = nakedFirstLine.slice(i) + completionLines.slice(1).join('\n')

        return completion
    }

    public async generateCompletions(abortSignal: AbortSignal, n?: number): Promise<Completion[]> {
        const prefix = this.prefix + this.injectPrefix

        // Create prompt
        const prompt = this.createPrompt()
        if (prompt.length > this.promptChars) {
            throw new Error('prompt length exceeded maximum alloted chars')
        }

        // Issue request
        const responses = await batchCompletions(
            this.completionsClient,
            {
                messages: prompt,
                // stopSequences:
                //     this.multilineMode !== null ? [anthropic.HUMAN_PROMPT, '\n\n\n'] : [anthropic.HUMAN_PROMPT, '\n'],
                maxTokensToSample: this.responseTokens,
                temperature: 0.5, // TODO(beyang): revisit
                // topK: -1,
                // topP: 0.9,
            },
            n || this.defaultN,
            abortSignal
        )

        // Post-process
        const ret = await Promise.all(
            responses.map(async resp => {
                const content = await this.postProcess(resp.completion)

                if (content === null) {
                    return []
                }

                return [
                    {
                        prefix,
                        messages: prompt,
                        content,
                        stopReason: resp.stopReason,
                    },
                ]
            })
        )
        return ret.flat()
    }
}

function extractFromCodeBlock(completion: string): string {
    if (completion.indexOf('<CODE5711>') !== -1) {
        console.error('TODO invalid 1: ', completion)
        return ''
    }
    let end = completion.indexOf('\n</CODE5711>')
    if (end === -1) {
        end = completion.length
    }
    return completion.substring(0, end)
}

// function extractFromCodeBlock(completion: string): string {
//     const start = completion.indexOf('<CODE5711>')
//     if (start === -1) {
//         console.error('TODO invalid 0: ', completion)
//         return ''
//     }
//     if (completion.indexOf('<CODE5711>', start + 1) !== -1) {
//         console.error('TODO invalid 1: ', completion)
//         return ''
//     }
//     let end = completion.indexOf('</CODE5711>', start)
//     if (end === -1) {
//         end = completion.length
//     }
//     return completion.substring(start + '<CODE5711>'.length, end).trim()
// }

function greatestCommonPrefix(s1: string, s2: string): string {
    let i = 0
    while (i < s1.length && i < s2.length && s1[i] === s2[i]) {
        i++
    }
    return s1.substring(0, i)
}

// get the suffix of the string that is the last non-empty line, onward
function getTail(s: string, trimStart: boolean): string | undefined {
    const lines = s.split('\n')
    const idx = lines.findLastIndex(l => l.trim().length > 0)
    if (idx === -1) {
        return undefined
    }
    if (trimStart) {
        return lines.slice(idx).join('\n').trimStart()
    } else {
        return lines.slice(idx).join('\n')
    }
}
