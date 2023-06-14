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
                text:
                `Only respond with code completions in between tags like this:
<code>
// Code goes here
</code>
All answers must be valid ${this.languageId} programs.
Complete the following file:
<code>
${this.prefix}
</code>`
            },
            {
                speaker: 'assistant',
                text: '',
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

    private postProcess(completion: string): string {
        // Parse XML
        // MARK
        
        // let suggestion = completion
        // const endBlockIndex = completion.indexOf('```')
        // if (endBlockIndex !== -1) {
        //     suggestion = completion.slice(0, endBlockIndex)
        // }

        // // Remove trailing whitespace before newlines
        // suggestion = suggestion
        //     .split('\n')
        //     .map(line => line.trimEnd())
        //     .join('\n')

        // return sliceUntilFirstNLinesOfSuffixMatch(suggestion, this.suffix, 5)
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
                temperature: 1,
                topK: -1,
                topP: -1,
            },
            n || this.defaultN,
            abortSignal
        )

        // Post-process
        return responses.flatMap(resp => {
            const content = this.postProcess(resp.completion)

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
    }
}
