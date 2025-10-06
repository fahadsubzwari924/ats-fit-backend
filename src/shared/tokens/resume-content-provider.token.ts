/**
 * Dependency injection token for resume content provider
 *
 * This token enables dependency injection of IResumeContentProvider
 * implementations without creating circular dependencies between modules.
 *
 * Usage:
 * @Inject(RESUME_CONTENT_PROVIDER) private resumeProvider: IResumeContentProvider
 */
export const RESUME_CONTENT_PROVIDER = Symbol('RESUME_CONTENT_PROVIDER');
