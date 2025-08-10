# Local LLM Module

This module provides resume analysis functionality using a local Phi3 Mini model running via Ollama instead of external APIs like OpenAI or Claude.

## Features

- **Resume Analysis**: Extract structured information from PDF resumes
- **Job Matching**: Analyze how well a resume matches a job description
- **Local Processing**: All processing happens locally using Phi3 Mini via Ollama
- **No External API Costs**: No charges for OpenAI or Claude API usage

## Prerequisites

### 1. Install Ollama

Visit [Ollama's website](https://ollama.ai) and install Ollama for your operating system.

### 2. Download Phi3 Mini Model

```bash
ollama pull phi3:mini
```

### 3. Start Ollama Service

```bash
ollama serve
```

The service will start on `http://localhost:11434` by default.

## API Endpoints

### 1. Analyze Resume

**POST** `/local-llm/analyze-resume`

Analyzes a resume PDF against a job description and returns structured data.

#### Request

- **Content-Type**: `multipart/form-data`
- **Body**:
  - `resumeFile` (file): PDF file of the resume
  - `jobDescription` (string): Job description to analyze against

#### Response

```json
{
  "success": true,
  "data": {
    "originalResumeText": "extracted text from PDF...",
    "extractedData": {
      "title": "Senior Software Engineer",
      "contactInfo": {
        "name": "John Doe",
        "email": "john@example.com",
        "phone": "+1234567890",
        "location": "San Francisco, CA",
        "linkedin": "https://linkedin.com/in/johndoe",
        "portfolio": "https://johndoe.dev",
        "github": "https://github.com/johndoe"
      },
      "summary": "Experienced software engineer...",
      "skills": {
        "languages": ["JavaScript", "Python", "TypeScript"],
        "frameworks": ["React", "Node.js", "Express"],
        "tools": ["Docker", "Git", "AWS"],
        "databases": ["PostgreSQL", "MongoDB"],
        "concepts": ["Microservices", "CI/CD", "TDD"]
      },
      "experience": [...],
      "education": [...],
      "certifications": [...],
      "additionalSections": [...]
    },
    "jobAnalysis": {
      "requiredSkills": {
        "hardSkills": ["React", "Node.js", "TypeScript"],
        "softSkills": ["Leadership", "Communication"],
        "qualifications": ["Bachelor's degree", "5+ years experience"],
        "keywords": ["full-stack", "senior", "team lead"]
      },
      "matchAnalysis": {
        "skillMatchScore": 0.85,
        "missingKeywords": ["GraphQL", "Kubernetes"],
        "strengths": ["Strong React experience", "Leadership background"],
        "recommendations": ["Consider learning GraphQL", "Highlight DevOps experience"]
      }
    },
    "metadata": {
      "processingTime": 5420,
      "modelUsed": "phi3:mini",
      "confidence": 92
    }
  },
  "message": "Resume analysis completed successfully"
}
```

### 2. Health Check

**GET** `/local-llm/health`

Checks if the local LLM service is running and available.

#### Response

```json
{
  "status": "healthy",
  "model": "phi3:mini",
  "available": true,
  "timestamp": "2024-07-26T10:30:00.000Z",
  "message": "Local LLM service is running and model is available"
}
```

## Configuration

Add these environment variables to your `.env` file:

```env
# Local LLM Configuration
LOCAL_LLM_OLLAMA_URL=http://localhost:11434
LOCAL_LLM_MODEL=phi3:mini
LOCAL_LLM_TIMEOUT=120000
```

## Usage Examples

### cURL Example

```bash
# Analyze resume
curl -X POST http://localhost:3000/local-llm/analyze-resume \
  -H "Content-Type: multipart/form-data" \
  -F "resumeFile=@/path/to/resume.pdf" \
  -F "jobDescription=We are looking for a Senior Software Engineer with 5+ years of experience..."

# Health check
curl http://localhost:3000/local-llm/health
```

### JavaScript/TypeScript Example

```typescript
const formData = new FormData();
formData.append('resumeFile', resumeFile); // File object
formData.append('jobDescription', 'Job description text...');

const response = await fetch('http://localhost:3000/local-llm/analyze-resume', {
  method: 'POST',
  body: formData,
});

const result = await response.json();
console.log(result.data);
```

## Performance Notes

- **Processing Time**: Local analysis typically takes 5-15 seconds depending on resume complexity
- **Model Size**: Phi3 Mini is approximately 2.3GB
- **Memory Usage**: Requires about 4GB RAM for optimal performance
- **Concurrent Requests**: Limited by local hardware; recommended max 2-3 concurrent requests

## Troubleshooting

### Common Issues

1. **"Local LLM service is not available"**
   - Ensure Ollama is installed and running
   - Check if the service is accessible at `http://localhost:11434`

2. **"Model not found"**
   - Run `ollama pull phi3:mini` to download the model
   - Verify model is available with `ollama list`

3. **Timeout errors**
   - Increase `LOCAL_LLM_TIMEOUT` in environment variables
   - Check system resources (CPU/Memory)

4. **JSON parsing errors**
   - The model may occasionally return invalid JSON
   - The service automatically retries up to 3 times

### Health Check Commands

```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# List available models
ollama list

# Test model directly
ollama run phi3:mini "Hello, how are you?"
```

## Integration with Existing System

This module is designed to work alongside your existing OpenAI/Claude-based resume generation system. You can:

1. Use it as a backup when external APIs are unavailable
2. Offer it as a privacy-focused option for sensitive resumes
3. Use it for development/testing to avoid API costs
4. Compare results between local and cloud-based analysis

The response format is designed to be compatible with your existing resume analysis workflows.
