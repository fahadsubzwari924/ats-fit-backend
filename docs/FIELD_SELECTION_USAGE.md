# Dynamic Field Selection Usage Examples

This document shows how to use the dynamic field selection feature for job applications endpoints.

## Base URLs

- Get all job applications: `GET /api/v1/job-applications`
- Get single job application: `GET /api/v1/job-applications/{id}`
- Get job application stats: `GET /api/v1/job-applications/stats`

## Field Selection Parameter

Use the `fields` query parameter to specify which fields you want to return:

```
?fields=field1,field2,field3
```

## Available Fields

### Main Entity Fields

- `id` - Job application ID
- `company_name` - Company name
- `job_position` - Job position title
- `job_description` - Job description
- `job_url` - Job posting URL
- `job_location` - Job location
- `current_salary` - Current salary
- `expected_salary` - Expected salary
- `status` - Application status
- `application_source` - How application was created
- `application_deadline` - Application deadline
- `applied_at` - When application was submitted
- `ats_score` - ATS matching score
- `ats_analysis` - Detailed ATS analysis
- `cover_letter` - Cover letter content
- `notes` - Application notes
- `contact_phone` - Contact phone number
- `interview_scheduled_at` - Interview date/time
- `interview_notes` - Interview notes
- `follow_up_date` - Follow-up date
- `rejection_reason` - Rejection reason
- `metadata` - Additional metadata
- `created_at` - Creation timestamp
- `updated_at` - Last update timestamp
- `user_id` - User ID
- `guest_id` - Guest ID

### Relation Fields

- `user.id` - User ID
- `user.email` - User email
- `user.firstName` - User first name
- `user.lastName` - User last name
- `ats_match_history.id` - ATS match history ID
- `ats_match_history.match_score` - Match score
- `ats_match_history.created_at` - ATS analysis date
- `resume_generation.id` - Resume generation ID
- `resume_generation.template_name` - Resume template used
- `resume_generation.created_at` - Resume creation date

## Usage Examples

### Example 1: Get minimal job application list

```
GET /api/v1/job-applications?fields=id,company_name,job_position,status
```

Response:

```json
{
  "status": "success",
  "data": {
    "applications": [
      {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "company_name": "Tech Corp",
        "job_position": "Software Engineer",
        "status": "applied"
      }
    ],
    "total": 1,
    "count": 1,
    "offset": 0,
    "limit": 20
  }
}
```

### Example 2: Get detailed job application with ATS data

```
GET /api/v1/job-applications?fields=id,company_name,job_position,status,ats_score,applied_at,created_at
```

### Example 3: Get job application with user information

```
GET /api/v1/job-applications?fields=id,company_name,status,user.email,user.firstName
```

### Example 4: Get single job application with specific fields

```
GET /api/v1/job-applications/123e4567-e89b-12d3-a456-426614174000?fields=company_name,job_position,job_description,ats_score,ats_analysis
```

### Example 5: Get all fields (default behavior)

```
GET /api/v1/job-applications
```

## Performance Benefits

1. **Reduced Network Traffic**: Only requested fields are returned
2. **Faster Database Queries**: Only selected fields are fetched from database
3. **Lower Memory Usage**: Smaller response objects
4. **Better Mobile Performance**: Reduced data usage for mobile clients

## Security

- Only whitelisted fields can be requested
- Field validation prevents unauthorized data access
- Relation fields are properly secured through TypeORM relations

## Error Handling

If invalid fields are requested, they are simply ignored. The API returns only valid, allowed fields.

## Frontend Integration Examples

### React/TypeScript Example

```typescript
interface JobApplicationListParams {
  fields?: string[];
  status?: string;
  limit?: number;
}

const fetchJobApplications = async (params: JobApplicationListParams) => {
  const queryParams = new URLSearchParams();

  if (params.fields) {
    queryParams.append('fields', params.fields.join(','));
  }
  if (params.status) {
    queryParams.append('status', params.status);
  }
  if (params.limit) {
    queryParams.append('limit', params.limit.toString());
  }

  const response = await fetch(`/api/v1/job-applications?${queryParams}`);
  return response.json();
};

// Usage
const applications = await fetchJobApplications({
  fields: ['id', 'company_name', 'status', 'ats_score'],
  status: 'applied',
  limit: 10,
});
```

### JavaScript Example

```javascript
// Minimal data for listing
const listData = await fetch(
  '/api/v1/job-applications?fields=id,company_name,job_position,status',
).then((res) => res.json());

// Detailed data for editing
const editData = await fetch(
  '/api/v1/job-applications/123?fields=id,company_name,job_position,job_description,status,notes',
).then((res) => res.json());
```
