# Question-Based Resume Tailoring Feature (v3)

## Overview

The Question-Based Resume Tailoring feature is a revolutionary 2-step process that eliminates AI hallucination in resume generation by gathering factual information directly from users before tailoring their resumes.

### The Problem

Previous resume tailoring approaches suffered from AI hallucination:

- AI would invent metrics, numbers, and percentages
- Business impact claims were fabricated without user input
- Users couldn't trust the quantifiable achievements in their resumes

### The Solution

A structured 2-step process:

1. **Question Generation**: AI analyzes job description and resume to generate targeted questions
2. **Fact-Based Tailoring**: AI uses ONLY user-provided facts to create tailored bullet points

## Architecture

### Database Entities

#### 1. TailoringSession

Tracks the complete lifecycle of a question-based tailoring session.

**Fields:**

- `id`: UUID primary key
- `userId`: User ID (nullable for guest users)
- `guestId`: Guest ID (nullable for registered users)
- `resumeId`: Reference to existing resume (nullable)
- `jobPosition`: Target job position
- `companyName`: Target company name
- `jobDescription`: Complete job description
- `templateId`: Resume template ID
- `status`: Session status (created | questions_generated | responses_submitted | resume_generating | completed | failed)
- `resumeFileName`, `resumeFileSize`, `resumeContent`: Uploaded resume details
- `questionsGeneratedAt`, `responsesSubmittedAt`, `resumeGenerationCompletedAt`: Timestamps
- `queueMessageId`: For async processing
- `resultMetadata`: JSON metadata about results
- `errorMessage`: Error details if failed

**Lifecycle:**

1. `created` - Session initialized
2. `questions_generated` - AI generated questions
3. `responses_submitted` - User provided answers
4. `resume_generating` - AI creating tailored resume
5. `completed` - Resume successfully generated
6. `failed` - Error at any stage

#### 2. TailoringQuestion

Individual questions generated for each work experience bullet point.

**Fields:**

- `id`: UUID primary key
- `sessionId`: Foreign key to TailoringSession
- `workExperienceIndex`: Index of work experience (0-based)
- `bulletPointIndex`: Index of bullet point within experience (0-based)
- `originalBulletPoint`: Original text from resume
- `questionText`: AI-generated question
- `questionCategory`: Type (metrics | impact | scope | technology | outcome)
- `userResponse`: User's answer (nullable until answered)
- `isAnswered`: Boolean flag
- `orderIndex`: Display order

### Services

#### 1. QuestionGenerationService

**Purpose**: Generate targeted questions based on resume and job description

**Key Method**: `initiateQuestionBasedTailoring()`

**Process:**

1. Extract/validate resume content (from file or database)
2. Create tailoring session in database
3. Call OpenAI GPT-4 Turbo to generate questions
4. Parse AI response and validate structure
5. Save questions to database
6. Return session ID and questions to user

**AI Prompt Strategy:**

- Analyzes job requirements for relevant metrics
- Identifies vague bullet points needing quantification
- Generates 1-3 questions per bullet point (15-25 total)
- Focuses on business impact, scale, and measurable outcomes
- Avoids questions that could encourage exaggeration

#### 2. FactBasedResumeTailoringService

**Purpose**: Generate tailored resume using ONLY user-provided facts

**Key Methods:**

- `submitQuestionResponses()`: Save user answers
- `generateFactBasedResume()`: Create tailored resume

**Process:**

1. Validate session has responses
2. Format questions and responses for AI
3. Call Claude 3.5 Sonnet (with OpenAI fallback)
4. Parse optimized resume content
5. Update session as completed
6. Return resume with enhancement metrics

**AI Prompt Strategy:**

- **ZERO HALLUCINATION POLICY**: Explicit instructions to use only user facts
- If user didn't provide numbers, focus on actions and impact
- Never invent metrics, percentages, or dollar amounts
- CAR method (Context, Action, Result) for bullet points
- Natural keyword integration from job description

### AI Prompt Engineering

#### Question Generation Prompt

**Model**: GPT-4 Turbo
**Temperature**: 0.3 (balanced creativity)
**Key Instructions:**

- Generate 1-3 questions per bullet point
- Focus on quantifiable metrics and business impact
- Categorize by type (metrics, impact, scope, technology, outcome)
- Skip already quantified bullet points
- Keep total questions reasonable (15-25 max)

**Example Questions:**

- "How many users were impacted by these new features, and what measurable improvements did they experience?"
- "What specific percentage did performance improve, and how did this impact users or business operations?"
- "How large was the team you led, and what was the project timeline?"

#### Fact-Based Tailoring Prompt

**Model**: Claude 3.5 Sonnet (fallback: GPT-4 Turbo)
**Temperature**: 0.2 (very factual)
**Critical Rule**: **ZERO HALLUCINATION POLICY**

**Key Instructions:**

- Use ONLY facts from user responses
- Never invent numbers, percentages, or metrics
- If no metrics provided, write impactful bullets about actions
- Apply CAR method to all bullet points
- Integrate job description keywords naturally
- Most recent position: ALL bullet points
- Previous positions: 3-4 most relevant bullet points

## API Endpoints

### 1. POST `/api/v1/resume-tailoring/question-based/initiate`

**Purpose**: Start question-based tailoring and get questions

**Request:**

```typescript
{
  jobPosition: string;      // "Senior Full Stack Developer"
  jobDescription: string;   // Complete job description
  companyName: string;      // "Google Inc."
  templateId: string;       // UUID of template
  resumeId?: string;        // Optional: existing resume ID
  resumeFile?: File;        // Optional: uploaded PDF
}
```

**Response:**

```typescript
{
  sessionId: string;
  questions: Array<{
    id: string;
    workExperienceTitle: string;
    workExperienceIndex: number;
    bulletPointIndex: number;
    originalBulletPoint: string;
    questionText: string;
    questionCategory: string;
  }>;
  analysis: {
    totalWorkExperiences: number;
    totalBulletPoints: number;
    questionsGenerated: number;
    strengthAreas: string[];
    improvementAreas: string[];
    jobAlignmentScore: number;
  };
  recommendations: string[];
}
```

**Response Time**: 5-10 seconds

### 2. GET `/api/v1/resume-tailoring/question-based/session/:sessionId`

**Purpose**: Retrieve session details and questions

**Response:**

```typescript
{
  session: {
    id: string;
    status: string;
    jobPosition: string;
    companyName: string;
    createdAt: Date;
  }
  questions: Array<{
    id: string;
    workExperienceTitle: string;
    originalBulletPoint: string;
    questionText: string;
    questionCategory: string;
    isAnswered: boolean;
    userResponse?: string;
  }>;
}
```

### 3. POST `/api/v1/resume-tailoring/question-based/submit-responses`

**Purpose**: Submit answers to questions

**Request:**

```typescript
{
  sessionId: string;
  responses: Array<{
    questionId: string;
    response: string; // User's factual answer
  }>;
}
```

**Response:**

```typescript
{
  sessionId: string;
  status: string;
  questionsAnswered: number;
  message: string;
}
```

**Response Time**: <1 second

### 4. POST `/api/v1/resume-tailoring/question-based/generate/:sessionId`

**Purpose**: Generate final fact-based tailored resume

**Response:**

```typescript
{
  sessionId: string;
  resumeContent: {
    title: string;
    contactInfo: {...};
    summary: string;
    skills: {...};
    experience: [...];
    education: [...];
    certifications: [...];
  };
  enhancementMetrics: {
    bulletPointsEnhanced: number;
    metricsAdded: number;
    keywordsIntegrated: number;
    userResponsesUsed: number;
    confidenceScore: number;
  };
  message: string;
}
```

**Response Time**: 30-60 seconds

## User Flow

### Complete Workflow

```
1. User Initiates Tailoring
   ↓
   POST /initiate
   - Upload resume OR use existing
   - Provide job details
   ↓
2. AI Generates Questions (5-10s)
   ↓
3. User Receives Questions
   - 15-25 targeted questions
   - Categorized by work experience
   ↓
4. User Answers Questions
   - Provides facts, numbers, metrics
   - Can skip questions if no data
   ↓
   POST /submit-responses
   ↓
5. User Requests Resume Generation
   ↓
   POST /generate/:sessionId
   ↓
6. AI Creates Fact-Based Resume (30-60s)
   ↓
7. User Receives Tailored Resume
   - All data from user responses
   - No hallucinated metrics
   - ATS-optimized with keywords
```

## Benefits

### For Users

- ✅ **Trust**: All metrics are user-provided facts
- ✅ **Accuracy**: No hallucinated achievements
- ✅ **Control**: User decides what information to include
- ✅ **Guidance**: Structured questions help recall accomplishments
- ✅ **Quality**: Business impact-focused questions

### For Product

- ✅ **Differentiation**: Unique approach in the market
- ✅ **Accuracy**: Higher quality resumes
- ✅ **User Satisfaction**: Transparent process
- ✅ **Compliance**: No false information generation

## Technical Details

### Dependencies

- **OpenAI GPT-4 Turbo**: Question generation
- **Claude 3.5 Sonnet**: Primary resume tailoring
- **OpenAI GPT-4 Turbo**: Fallback for resume tailoring
- **TypeORM**: Database operations
- **NestJS**: Framework and dependency injection

### Error Handling

- Session validation at each step
- User ownership verification
- Comprehensive error logging
- Graceful AI fallback (Claude → OpenAI)
- Transaction safety for database operations

### Performance Optimizations

- Session-based workflow (no redundant AI calls)
- Indexed database queries
- Efficient PDF parsing
- Response caching where applicable

### Security

- User/guest ownership validation
- Session ID verification
- Rate limiting on all endpoints
- File validation for uploads
- SQL injection prevention via TypeORM

## Future Enhancements

### Potential Improvements

1. **Auto-save responses**: Save answers as user types
2. **Smart suggestions**: Provide example metrics for common roles
3. **Batch question answering**: Group related questions
4. **Progress tracking**: Show % complete for questions
5. **Resume comparison**: Show before/after diff
6. **Export options**: Multiple format support
7. **Question templates**: Pre-built questions by industry
8. **AI coaching**: Tips on how to answer each question

### Scalability Considerations

1. **Async processing**: Move resume generation to queue
2. **Caching**: Cache common questions by job type
3. **Batch operations**: Generate questions for multiple resumes
4. **CDN integration**: Serve PDFs from CDN

## Testing Strategy

### Unit Tests

- Question generation service
- Fact-based tailoring service
- AI prompt validation
- Database operations

### Integration Tests

- End-to-end workflow
- AI service integration
- Database transactions
- File upload handling

### Manual Testing Checklist

- [ ] Guest user can initiate tailoring
- [ ] Registered user can use existing resume
- [ ] Questions are relevant to job description
- [ ] Questions target unquantified bullet points
- [ ] User responses are saved correctly
- [ ] Resume uses only user-provided facts
- [ ] No hallucinated metrics in output
- [ ] Session status updates correctly
- [ ] Error handling works at each step
- [ ] Rate limiting prevents abuse

## Migration Guide

### Database Migration

```sql
-- Create tailoring_sessions table
CREATE TABLE tailoring_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  guest_id VARCHAR(255),
  resume_id UUID,
  job_position VARCHAR(100) NOT NULL,
  company_name VARCHAR(100) NOT NULL,
  job_description TEXT NOT NULL,
  template_id UUID NOT NULL,
  status VARCHAR(50) DEFAULT 'created',
  resume_file_name VARCHAR(255),
  resume_file_size INTEGER,
  resume_content TEXT,
  questions_generated_at TIMESTAMP,
  responses_submitted_at TIMESTAMP,
  resume_generation_completed_at TIMESTAMP,
  queue_message_id UUID,
  result_metadata JSONB,
  error_message TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create tailoring_questions table
CREATE TABLE tailoring_questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES tailoring_sessions(id) ON DELETE CASCADE,
  work_experience_index INTEGER NOT NULL,
  bullet_point_index INTEGER NOT NULL,
  original_bullet_point TEXT NOT NULL,
  question_text TEXT NOT NULL,
  question_category VARCHAR(50) NOT NULL,
  user_response TEXT,
  is_answered BOOLEAN DEFAULT false,
  order_index INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_tailoring_sessions_user_id ON tailoring_sessions(user_id);
CREATE INDEX idx_tailoring_sessions_guest_id ON tailoring_sessions(guest_id);
CREATE INDEX idx_tailoring_sessions_status ON tailoring_sessions(status);
CREATE INDEX idx_tailoring_questions_session_id ON tailoring_questions(session_id);
```

## Conclusion

The Question-Based Resume Tailoring feature represents a significant advancement in AI-powered resume generation. By separating question generation from resume creation and using only user-provided facts, we've eliminated the hallucination problem while maintaining high-quality, ATS-optimized output.

This feature provides users with confidence that their resumes contain only truthful information, guided by AI to highlight the most impactful achievements for their target roles.
