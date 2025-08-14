import { Assistant, AssistantExtension, fs, joinPath } from '@janhq/core'
export default class JanAssistantExtension extends AssistantExtension {
  async onLoad() {
    if (!(await fs.existsSync('file://assistants'))) {
      await fs.mkdir('file://assistants')
    }
    const assistants = await this.getAssistants()
    if (assistants.length === 0) {
      await this.createAssistant(this.defaultAssistant)
    }
  }

  /**
   * Called when the extension is unloaded.
   */
  onUnload(): void {}

  async getAssistants(): Promise<Assistant[]> {
    if (!(await fs.existsSync('file://assistants')))
      return [this.defaultAssistant]
    const assistants = await fs.readdirSync('file://assistants')
    const assistantsData: Assistant[] = []
    for (const assistant of assistants) {
      const assistantPath = await joinPath([
        'file://assistants',
        assistant,
        'assistant.json',
      ])
      if (!(await fs.existsSync(assistantPath))) {
        console.warn(`Assistant file not found: ${assistantPath}`)
        continue
      }
      try {
        const assistantData = JSON.parse(await fs.readFileSync(assistantPath))
        assistantsData.push(assistantData as Assistant)
      } catch (error) {
        console.error(`Failed to read assistant ${assistant}:`, error)
      }
    }
    return assistantsData
  }

  async createAssistant(assistant: Assistant): Promise<void> {
    const assistantPath = await joinPath([
      'file://assistants',
      assistant.id,
      'assistant.json',
    ])
    const assistantFolder = await joinPath(['file://assistants', assistant.id])
    if (!(await fs.existsSync(assistantFolder))) {
      await fs.mkdir(assistantFolder)
    }
    await fs.writeFileSync(assistantPath, JSON.stringify(assistant, null, 2))
  }

  async deleteAssistant(assistant: Assistant): Promise<void> {
    const assistantPath = await joinPath([
      'file://assistants',
      assistant.id,
      'assistant.json',
    ])
    if (await fs.existsSync(assistantPath)) {
      await fs.rm(assistantPath)
    }
  }

  private defaultAssistant: Assistant = {
    avatar: '🎮',
    thread_location: undefined,
    id: 'Friday',
    object: 'assistant',
    created_at: Date.now() / 1000,
    name: 'Friday',
    description:
      'Friday is an expert in game development that will save you some serious time and boost your productivity 10 folds.',
    model: '*',
    instructions:
      'You are an expert in game development. Your primary goal is to completely satisfy the user with their questions and tasks to the best of your abilities. \n\n To answer the question or complete the users task, the most important thing is relevant context. Make relevant web searches to gain a better understanding. Use your available tools to your power. Gain a deeper understanding of the problem, then apply the best practices for the task. \n\nWhen responding:\n- Answer directly from the context you gained\n- Be concise, clear, and an expert\n- If you are clarifying things with the user, you should always provide justification and possible approaches.\n\n Tools are your best asset, when available to you:\n- Think how you can use tools to your power to get the job DONE, dont ignore them. \n- Always try to use tools effectively. \nWhen using tools:\n- Use one tool at a time and wait for results\n- Use actual values as arguments, not variable names\n- Learn from each result before deciding next steps\n- Avoid repeating the same tool call with identical parameters.',
    tools: [
      {
        type: 'retrieval',
        enabled: false,
        useTimeWeightedRetriever: false,
        settings: {
          top_k: 2,
          chunk_size: 1024,
          chunk_overlap: 64,
          retrieval_template: `Use the following pieces of context to answer the question at the end.
----------------
CONTEXT: {CONTEXT}
----------------
QUESTION: {QUESTION}
----------------
Helpful Answer:`,
        },
      },
    ],
    file_ids: [],
    metadata: undefined,
  }
}
