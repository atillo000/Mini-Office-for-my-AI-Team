import { z } from 'zod';
import type { Store } from '../db';
import { digest } from '../agents/artifacts';
import type { Job } from '../../shared/types';
import type { KnowledgeProject } from '../../shared/work';
import type { ContentRequest, StudioSnapshot, VideoBrief, VideoIdea } from '../../shared/studio';
import { WorkService } from '../work/service';
import { projectInput } from '../work/schemas';
import { MemoryService } from './memory';
const text = z.string().trim().min(1).max(4000);
export const briefInput = z
  .object({
    version: z.number().int().min(1),
    direction: text,
    audience: text,
    language: z.string().trim().min(1).max(200),
    durationSeconds: z.number().int().min(15).max(180),
  })
  .strict();
export const ideaContent = z
  .object({
    title: z.string().trim().min(1).max(180),
    genre: z.string().trim().min(1).max(80),
    hook: text,
    concept: text,
    language: z.string().trim().min(1).max(100),
    durationSeconds: z.number().int().min(15).max(180),
    script: z.string().trim().min(1).max(6000),
    scenes: z
      .array(
        z
          .object({ visual: text, narration: text, seconds: z.number().int().min(1).max(180) })
          .strict(),
      )
      .min(1)
      .max(10),
    youtubeCaption: text,
    facebookCaption: text,
  })
  .strict()
  .superRefine((v, c) => {
    if (v.scenes.reduce((n, s) => n + s.seconds, 0) !== v.durationSeconds)
      c.addIssue({ code: 'custom', message: 'Scene durations must add up to the video duration.' });
  });
export const generatedIdeas = z.object({ ideas: z.array(ideaContent).length(3) }).strict();
export const ideasOutputSchema = z.toJSONSchema(generatedIdeas, { unrepresentable: 'any' });
export function contentOf(idea: VideoIdea) {
  const {
    title,
    genre,
    hook,
    concept,
    language,
    durationSeconds,
    script,
    scenes,
    youtubeCaption,
    facebookCaption,
  } = idea;
  return {
    title,
    genre,
    hook,
    concept,
    language,
    durationSeconds,
    script,
    scenes,
    youtubeCaption,
    facebookCaption,
  };
}
export function contentScope(request: ContentRequest) {
  return digest({
    ...request,
    memory: request.memory ? { ...request.memory, capturedAt: 0 } : null,
  });
}
export class StudioService {
  constructor(public store: Store) {}
  snapshot(): StudioSnapshot {
    const id = this.store.get<{ projectId: string }>('settings', 'video_studio')?.projectId;
    return {
      profile: new MemoryService(this.store).profile(),
      project: id ? this.store.get<KnowledgeProject>('knowledge_projects', id) || null : null,
      brief: id ? this.store.get<VideoBrief>('video_briefs', id) || null : null,
      ideas: this.store.list<VideoIdea>('video_ideas').filter((idea) => idea.projectId === id),
      jobs: this.store
        .list<Job>('jobs')
        .filter((job) => job.kind === 'content-ideas' && job.projectId === id),
      publishing: {
        youtube: 'NOT_CONNECTED',
        facebook: 'NOT_CONNECTED',
        videoRendering: 'NOT_CONNECTED',
      },
    };
  }
  setup() {
    return this.store.transaction(() => this.setupRecords());
  }
  private setupRecords() {
    if (this.snapshot().project) return this.snapshot();
    const project: KnowledgeProject = {
      ...projectInput.parse({
        name: 'AI Video Studio',
        aliases: ['AI videos'],
        role: 'PROJECT_OWNER',
        description:
          'Create original AI video ideas for YouTube and Facebook. The team discusses audience appeal; the CEO reviews drafts before approving an idea. Video production and posting require separate review.',
        department: 'Personal content project',
        applications: ['YouTube', 'Facebook'],
        responsibilities: [
          'Team brainstorms horror, comedy, drama and other ideas with broad Filipino audience appeal (patok sa masa).',
          'Save every idea as a draft for CEO review.',
          'Never publish based only on idea approval.',
        ],
      }),
      id: crypto.randomUUID(),
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.store.put('knowledge_projects', project.id, project);
    const brief: VideoBrief = {
      id: project.id,
      direction:
        'Discuss and propose original horror, comedy, drama or other short-video ideas that could be patok sa masa. The team should recommend the topics. Avoid claiming guaranteed virality or verified trends without evidence.',
      audience: 'Broad Filipino audience; relatable, entertaining and easy to follow.',
      language: 'Team recommends natural Filipino, Taglish or English to fit each idea.',
      durationSeconds: 60,
      version: 1,
      updatedAt: Date.now(),
    };
    {
      this.store.put('video_briefs', project.id, brief);
      this.store.put('settings', 'video_studio', { projectId: project.id });
      const starter = ideaContent.parse({
        title: 'The voice note from tomorrow',
        genre: 'Horror / mystery',
        hook: 'May voice note ka… pero bukas pa ang date.',
        concept:
          'An original fictional short: someone receives a voice note warning about a small event tomorrow. The harmless prediction comes true; the final message is an unexpected twist. Starter suggestion for review, not a generated or rendered video.',
        language: 'Filipino / Taglish (editable)',
        durationSeconds: 60,
        script:
          'Fictional starter outline: A person hears a voice note dated tomorrow. It predicts a cup will fall. The cup falls exactly as described. A second message arrives: “Huwag mong buksan ang pinto.” Cut before the reveal.',
        scenes: [
          {
            visual:
              'Phone screen showing a voice note with tomorrow’s date; original fictional character.',
            narration: 'May natanggap akong voice note. Ang petsa? Bukas pa.',
            seconds: 20,
          },
          {
            visual: 'A cup falls; the character looks back at the phone.',
            narration: 'Akala ko biro lang… hanggang nangyari ang sinabi niya.',
            seconds: 20,
          },
          {
            visual: 'A second voice note appears. A knock interrupts the quiet.',
            narration: '“Huwag mong buksan ang pinto.” Tapos, may kumatok.',
            seconds: 20,
          },
        ],
        youtubeCaption: 'A fictional mystery: a voice note from tomorrow. What would you do?',
        facebookCaption:
          'Kung may voice note galing bukas, pakikinggan mo ba? Original fictional story.',
      });
      this.insertIdea(project.id, starter, 'STARTER');
      new WorkService(this.store).audit(
        'VIDEO_STUDIO_CREATED',
        'knowledge_projects',
        project.id,
        project.version,
      );
      const memory = new MemoryService(this.store);
      if (!memory.profile().version) {
        this.store.put('work_profile', 'me', {
          ...memory.profile(),
          version: 1,
          updatedAt: Date.now(),
          about: 'I am building an AI video content project for my YouTube and Facebook pages.',
          responsibilities:
            'I review drafts and decide which ideas to approve. The AI team discusses and recommends topics.',
          communication:
            'Keep the app simple. Show drafts for review before moving forward. Idea approval does not authorize posting.',
          goals:
            'Create original horror, comedy, drama or other entertaining videos with broad Filipino audience appeal (patok sa masa).',
          confirmed: false,
        });
        new WorkService(this.store).audit('PROFILE_DRAFT_PREFILLED', 'work_profile', 'me', 1);
      }
    }
    return this.snapshot();
  }
  saveBrief(raw: unknown) {
    const input = briefInput.parse(raw);
    const current = this.snapshot().brief;
    if (!current || current.version !== input.version)
      throw new Error('Video brief changed; reload before saving.');
    const brief = { ...current, ...input, version: input.version + 1, updatedAt: Date.now() };
    return this.store.transaction(() => {
      this.store.put('video_briefs', brief.id, brief);
      new WorkService(this.store).audit(
        'VIDEO_BRIEF_UPDATED',
        'video_briefs',
        brief.id,
        brief.version,
      );
      return brief;
    });
  }
  insertIdea(
    projectId: string,
    content: z.infer<typeof ideaContent>,
    origin: VideoIdea['origin'],
    jobId?: string,
  ) {
    const idea: VideoIdea = {
      ...content,
      projectId,
      id: crypto.randomUUID(),
      status: 'DRAFT',
      origin,
      generationJobId: jobId,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      feedback: [],
    };
    this.store.put('video_ideas', idea.id, idea);
    return idea;
  }
  request(includeProfile: boolean): ContentRequest {
    const { project, brief } = this.snapshot();
    if (!project || !brief) throw new Error('Set up the video project first.');
    const memory = new MemoryService(this.store).context([project], includeProfile);
    return {
      brief,
      project: memory.projects[0],
      memory: includeProfile ? memory : null,
      feedback: this.snapshot()
        .ideas.flatMap((idea) =>
          idea.feedback.filter((f) => f.reusable).map((f) => `${f.action}: ${f.text}`),
        )
        .slice(-10),
    };
  }
  assertRequest(request: ContentRequest) {
    if (
      this.store.get<VideoBrief>('video_briefs', request.brief.id)?.version !==
        request.brief.version ||
      this.store.get<KnowledgeProject>('knowledge_projects', request.project.id)?.version !==
        request.project.version
    )
      throw new Error('Video project direction changed; approve a fresh generation request.');
    new MemoryService(this.store).assertCurrent(request.memory);
  }
  generated(job: Job, raw: unknown) {
    if (!job.contentRequest) throw new Error('No approved video brief');
    this.assertRequest(job.contentRequest);
    const output = generatedIdeas.parse(raw);
    if (
      output.ideas.some(
        (idea) => idea.durationSeconds !== job.contentRequest!.brief.durationSeconds,
      )
    )
      throw new Error('AI draft durations do not match the approved video brief.');
    return this.store.transaction(() => {
      if (this.store.list<VideoIdea>('video_ideas').some((i) => i.generationJobId === job.id))
        throw new Error('This generation already produced drafts.');
      return output.ideas.map((idea) => this.insertIdea(job.projectId, idea, 'AI', job.id));
    });
  }
  updateIdea(id: string, raw: unknown) {
    const { version, content } = z
      .object({ version: z.number().int().min(1), content: ideaContent })
      .strict()
      .parse(raw);
    return this.store.transaction(() => {
      const old = this.store.get<VideoIdea>('video_ideas', id);
      if (!old || old.version !== version) throw new Error('Idea changed. Reload before editing.');
      const idea: VideoIdea = {
        ...old,
        ...content,
        version: version + 1,
        updatedAt: Date.now(),
        status: 'DRAFT',
        approval: undefined,
      };
      this.store.put('video_ideas', id, idea);
      new WorkService(this.store).audit(
        'IDEA_EDITED_APPROVAL_INVALIDATED',
        'video_ideas',
        id,
        idea.version,
      );
      return idea;
    });
  }
  review(id: string, raw: unknown) {
    const data = z
      .object({
        version: z.number().int().min(1),
        contentHash: z.string().length(64),
        action: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REJECTED']),
        feedback: z.string().trim().max(2000).default(''),
        rememberFeedback: z.boolean().default(false),
      })
      .strict()
      .parse(raw);
    return this.store.transaction(() => {
      const idea = this.store.get<VideoIdea>('video_ideas', id);
      if (!idea || idea.version !== data.version || digest(contentOf(idea)) !== data.contentHash)
        throw new Error('Idea changed; review the current draft before approving.');
      if (idea.status === data.action) throw new Error('This review was already recorded.');
      if (data.action === 'CHANGES_REQUESTED' && !data.feedback)
        throw new Error('Describe the changes you want.');
      if (data.rememberFeedback && !data.feedback)
        throw new Error('Add feedback before saving a preference.');
      idea.status = data.action;
      idea.version++;
      idea.updatedAt = Date.now();
      idea.approval =
        data.action === 'APPROVED'
          ? {
              at: Date.now(),
              approvedBy: 'ceo',
              contentHash: data.contentHash,
              version: idea.version,
            }
          : undefined;
      idea.feedback.push({
        id: crypto.randomUUID(),
        text: data.feedback,
        action: data.action,
        at: Date.now(),
        reusable: data.rememberFeedback,
      });
      this.store.put('video_ideas', id, idea);
      new WorkService(this.store).audit(`IDEA_${data.action}`, 'video_ideas', id, idea.version);
      return idea;
    });
  }
}
