--
-- PostgreSQL database dump
--

-- Dumped from database version 14.6
-- Dumped by pg_dump version 14.17 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: rate_limit_configs_feature_type_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.rate_limit_configs_feature_type_enum AS ENUM (
    'resume_generation',
    'ats_score',
    'ats_score_history'
);


ALTER TYPE public.rate_limit_configs_feature_type_enum OWNER TO postgres;

--
-- Name: rate_limit_configs_plan_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.rate_limit_configs_plan_enum AS ENUM (
    'freemium',
    'premium'
);


ALTER TYPE public.rate_limit_configs_plan_enum OWNER TO postgres;

--
-- Name: rate_limit_configs_user_type_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.rate_limit_configs_user_type_enum AS ENUM (
    'guest',
    'registered'
);


ALTER TYPE public.rate_limit_configs_user_type_enum OWNER TO postgres;

--
-- Name: usage_tracking_feature_type_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.usage_tracking_feature_type_enum AS ENUM (
    'resume_generation',
    'ats_score',
    'ats_score_history'
);


ALTER TYPE public.usage_tracking_feature_type_enum OWNER TO postgres;

--
-- Name: users_plan_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.users_plan_enum AS ENUM (
    'freemium',
    'premium'
);


ALTER TYPE public.users_plan_enum OWNER TO postgres;

--
-- Name: users_user_type_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.users_user_type_enum AS ENUM (
    'guest',
    'registered'
);


ALTER TYPE public.users_user_type_enum OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ats_match_histories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ats_match_histories (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    guest_id character varying,
    resume_content text NOT NULL,
    job_description text NOT NULL,
    company_name character varying,
    ats_score double precision NOT NULL,
    analysis jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    user_id uuid
);


ALTER TABLE public.ats_match_histories OWNER TO postgres;

--
-- Name: migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.migrations (
    id integer NOT NULL,
    "timestamp" bigint NOT NULL,
    name character varying NOT NULL
);


ALTER TABLE public.migrations OWNER TO postgres;

--
-- Name: migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.migrations_id_seq OWNER TO postgres;

--
-- Name: migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.migrations_id_seq OWNED BY public.migrations.id;


--
-- Name: rate_limit_configs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rate_limit_configs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    plan public.rate_limit_configs_plan_enum NOT NULL,
    user_type public.rate_limit_configs_user_type_enum NOT NULL,
    feature_type public.rate_limit_configs_feature_type_enum NOT NULL,
    monthly_limit integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.rate_limit_configs OWNER TO postgres;

--
-- Name: resume_generations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.resume_generations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id character varying,
    guest_id character varying,
    file_path character varying NOT NULL,
    original_content text NOT NULL,
    template_id character varying,
    job_description character varying,
    company_name character varying,
    analysis jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    "userId" uuid,
    "templateId" uuid,
    tailored_content jsonb NOT NULL
);


ALTER TABLE public.resume_generations OWNER TO postgres;

--
-- Name: resume_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.resume_templates (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying NOT NULL,
    key character varying NOT NULL,
    description character varying NOT NULL,
    thumbnail_image_url character varying NOT NULL,
    remote_url character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.resume_templates OWNER TO postgres;

--
-- Name: usage_tracking; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.usage_tracking (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id character varying,
    guest_id character varying,
    ip_address character varying,
    feature_type public.usage_tracking_feature_type_enum NOT NULL,
    month integer NOT NULL,
    year integer NOT NULL,
    usage_count integer DEFAULT 1 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    last_used_at timestamp without time zone,
    "userId" uuid
);


ALTER TABLE public.usage_tracking OWNER TO postgres;

--
-- Name: user_resumes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_resumes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "fileName" character varying(255) NOT NULL,
    "fileSize" integer NOT NULL,
    "mimeType" character varying(50) NOT NULL,
    "s3Url" character varying(512) NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    user_id uuid,
    "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_resumes OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    full_name character varying NOT NULL,
    email character varying NOT NULL,
    password character varying NOT NULL,
    plan public.users_plan_enum DEFAULT 'freemium'::public.users_plan_enum NOT NULL,
    user_type public.users_user_type_enum DEFAULT 'registered'::public.users_user_type_enum NOT NULL,
    guest_id character varying,
    ip_address character varying,
    user_agent character varying,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: migrations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.migrations ALTER COLUMN id SET DEFAULT nextval('public.migrations_id_seq'::regclass);


--
-- Data for Name: ats_match_histories; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ats_match_histories (id, guest_id, resume_content, job_description, company_name, ats_score, analysis, created_at, user_id) FROM stdin;
99c4b049-df75-460f-a503-e605a08b0573	\N		About The Role\n\nAs a Senior Software Engineer, you will be a part of the asset monitoring team who can turn product ideas into reality by designing components and services for new feature developments. You will implement scalable architecture and work with an enthusiastic team contributing to robust projects that will be critical for fleets to be able to track everything from trailers down to individual tools at a job site and provide valuable and actionable real-time insights to help streamline operations and increase our customer’s profitability.\n\nWhat You'll Do\n\nCollaborate with several cross functional teams to design and document scalable solutions\nWrite secure, maintainable code that powers the platform that provides real time visibility into company’s assets\nBuild and make scalable design choices for API interfaces to work across internal and external applications and services Build appropriate monitoring, logging, debugging for the health of the system\nActively work on our AWS cloud infrastructure\nMentor and learn from the developers within the engineering organization\n\nWhat We're Looking For\n\nB.S. or M.S. in Computer Science or related field\n5+ years software development experience\nAn affinity for creating software that is extensible, performant, and easy to read\nExperience building product infrastructure, distributed systems and data models\nExperience in Ruby on Rails, Go Lang, Java, or similar language\nExperience with relational and NoSQL databases such as PostgreSQL, DynamoDB, Redis, and Cassandra\nExperience building for Cloud Infrastructure such as AWS, GCP, Azure or private clouds	\N	87	{"matched": {"hardSkills": ["AWS", "PostgreSQL", "Redis", "API development", "distributed systems", "real-time applications", "monitoring", "logging"], "softSkills": ["cross-functional collaboration", "mentoring", "technical leadership", "stakeholder management", "team coordination"], "qualifications": []}, "extracted": {"experience": {"level": "Senior", "years": 7, "reasoning": "Exceeds required 5+ years experience. Highly relevant experience in real-time tracking systems, distributed architectures, and asset monitoring applications. Direct experience with IoT data streams and high-volume data operations.", "relevance": 90}, "softSkills": {"matched": ["cross-functional collaboration", "mentoring", "technical leadership", "stakeholder management", "team coordination"], "reasoning": "Strong evidence of leadership, mentoring, and cross-functional collaboration. Demonstrates ability to work with various teams and stakeholders."}, "achievements": {"count": 8, "impact": 95, "quality": 92, "reasoning": "Strong quantifiable achievements including 40% reduction in manual intervention, 30% revenue increase, 25% decrease in bug rates. Demonstrates clear business impact and technical excellence."}, "technicalSkills": {"score": 85, "matched": ["AWS", "PostgreSQL", "Redis", "API development", "distributed systems", "real-time applications", "monitoring", "logging"], "missing": ["Ruby on Rails", "Go Lang", "Java", "DynamoDB", "Cassandra", "GCP", "Azure"], "reasoning": "Strong overlap in cloud and database technologies, with extensive AWS experience. While specific languages differ, candidate shows ability to learn new technologies and has comparable experience with Node.js and TypeScript."}}, "keywordScore": 85, "atsEvaluation": {"confidence": 90, "overallScore": 87, "softSkillsScore": 88, "achievementsScore": 92, "detailedBreakdown": {"redFlags": ["No direct experience with required languages (Ruby, Go, Java)", "Limited exposure to some required databases (DynamoDB, Cassandra)"], "strengths": ["Extensive real-time systems experience", "Strong AWS expertise", "Proven track record of quantifiable achievements", "Excellent leadership and mentoring capabilities", "Experience with high-volume data operations"], "experience": {"level": "Senior", "years": 7, "reasoning": "Exceeds required 5+ years experience. Highly relevant experience in real-time tracking systems, distributed architectures, and asset monitoring applications. Direct experience with IoT data streams and high-volume data operations.", "relevance": 90}, "softSkills": {"matched": ["cross-functional collaboration", "mentoring", "technical leadership", "stakeholder management", "team coordination"], "reasoning": "Strong evidence of leadership, mentoring, and cross-functional collaboration. Demonstrates ability to work with various teams and stakeholders."}, "weaknesses": ["Language stack mismatch", "Missing experience with some required databases", "No explicit private cloud experience"], "achievements": {"count": 8, "impact": 95, "quality": 92, "reasoning": "Strong quantifiable achievements including 40% reduction in manual intervention, 30% revenue increase, 25% decrease in bug rates. Demonstrates clear business impact and technical excellence."}, "recommendations": ["Highlight transferable skills from Node.js to Ruby/Go/Java", "Emphasize quick learning ability and technology adaptability", "Consider obtaining certifications in missing technologies", "Showcase distributed systems experience more prominently"], "technicalSkills": {"score": 85, "matched": ["AWS", "PostgreSQL", "Redis", "API development", "distributed systems", "real-time applications", "monitoring", "logging"], "missing": ["Ruby on Rails", "Go Lang", "Java", "DynamoDB", "Cassandra", "GCP", "Azure"], "reasoning": "Strong overlap in cloud and database technologies, with extensive AWS experience. While specific languages differ, candidate shows ability to learn new technologies and has comparable experience with Node.js and TypeScript."}}, "resumeQualityScore": 95, "technicalSkillsScore": 85, "experienceAlignmentScore": 90}, "sectionScores": {"softSkills": 88, "achievements": 92, "resumeQuality": 95, "technicalSkills": 85, "experienceAlignment": 90}, "structureScore": 95, "missingKeywords": ["Ruby on Rails", "Go Lang", "Java", "DynamoDB", "Cassandra", "GCP", "Azure"], "skillMatchScore": 0.85, "tailoredContent": {"strengths": ["Extensive real-time systems experience", "Strong AWS expertise", "Proven track record of quantifiable achievements", "Excellent leadership and mentoring capabilities", "Experience with high-volume data operations"], "weaknesses": ["Language stack mismatch", "Missing experience with some required databases", "No explicit private cloud experience"], "recommendations": ["Highlight transferable skills from Node.js to Ruby/Go/Java", "Emphasize quick learning ability and technology adaptability", "Consider obtaining certifications in missing technologies", "Showcase distributed systems experience more prominently"]}, "contactInfoScore": 95}	2025-07-18 01:50:17.564347	5264d5df-b3b5-4793-8fa3-736fbea8e31b
f232e2b2-9fcf-43d6-8dd8-4ca1a6646f1f	\N		About The Role\n\nAs a Senior Software Engineer, you will be a part of the asset monitoring team who can turn product ideas into reality by designing components and services for new feature developments. You will implement scalable architecture and work with an enthusiastic team contributing to robust projects that will be critical for fleets to be able to track everything from trailers down to individual tools at a job site and provide valuable and actionable real-time insights to help streamline operations and increase our customer’s profitability.\n\nWhat You'll Do\n\nCollaborate with several cross functional teams to design and document scalable solutions\nWrite secure, maintainable code that powers the platform that provides real time visibility into company’s assets\nBuild and make scalable design choices for API interfaces to work across internal and external applications and services Build appropriate monitoring, logging, debugging for the health of the system\nActively work on our AWS cloud infrastructure\nMentor and learn from the developers within the engineering organization\n\nWhat We're Looking For\n\nB.S. or M.S. in Computer Science or related field\n5+ years software development experience\nAn affinity for creating software that is extensible, performant, and easy to read\nExperience building product infrastructure, distributed systems and data models\nExperience in Ruby on Rails, Go Lang, Java, or similar language\nExperience with relational and NoSQL databases such as PostgreSQL, DynamoDB, Redis, and Cassandra\nExperience building for Cloud Infrastructure such as AWS, GCP, Azure or private clouds	\N	87	{"matched": {"hardSkills": ["AWS", "PostgreSQL", "Redis", "API development", "distributed systems", "real-time applications", "monitoring", "logging"], "softSkills": ["cross-functional collaboration", "mentoring", "team leadership", "stakeholder management", "technical documentation"], "qualifications": []}, "extracted": {"experience": {"level": "Senior", "years": 7, "reasoning": "Exceeds required 5+ years experience. Direct experience with real-time tracking systems and asset monitoring at UTF Labs. Strong background in scalable architecture and distributed systems.", "relevance": 90}, "softSkills": {"matched": ["cross-functional collaboration", "mentoring", "team leadership", "stakeholder management", "technical documentation"], "reasoning": "Strong evidence of leadership and collaboration skills, particularly in mentoring and cross-functional team coordination."}, "achievements": {"count": 12, "impact": 95, "quality": 92, "reasoning": "Impressive quantifiable achievements including 40% reduction in manual intervention, 30% revenue increase, and 25% improvement in user engagement. Demonstrates clear business impact and technical excellence."}, "technicalSkills": {"score": 85, "matched": ["AWS", "PostgreSQL", "Redis", "API development", "distributed systems", "real-time applications", "monitoring", "logging"], "missing": ["Ruby on Rails", "Go Lang", "Java", "DynamoDB", "Cassandra", "GCP", "Azure"], "reasoning": "Strong overlap in cloud and database technologies, with extensive AWS experience. While specific languages differ, candidate shows adaptability with multiple programming languages and frameworks. Strong background in real-time systems and distributed architecture."}}, "keywordScore": 85, "atsEvaluation": {"confidence": 90, "overallScore": 87, "softSkillsScore": 88, "achievementsScore": 92, "detailedBreakdown": {"redFlags": ["No direct experience with required languages (Ruby, Go, Java)", "Limited exposure to some required NoSQL databases"], "strengths": ["Extensive real-time systems experience", "Strong AWS expertise", "Proven track record of quantifiable achievements", "Leadership and mentoring capabilities", "Experience with similar scale systems"], "experience": {"level": "Senior", "years": 7, "reasoning": "Exceeds required 5+ years experience. Direct experience with real-time tracking systems and asset monitoring at UTF Labs. Strong background in scalable architecture and distributed systems.", "relevance": 90}, "softSkills": {"matched": ["cross-functional collaboration", "mentoring", "team leadership", "stakeholder management", "technical documentation"], "reasoning": "Strong evidence of leadership and collaboration skills, particularly in mentoring and cross-functional team coordination."}, "weaknesses": ["Language stack mismatch", "Missing experience with some required databases", "No explicit private cloud experience"], "achievements": {"count": 12, "impact": 95, "quality": 92, "reasoning": "Impressive quantifiable achievements including 40% reduction in manual intervention, 30% revenue increase, and 25% improvement in user engagement. Demonstrates clear business impact and technical excellence."}, "recommendations": ["Highlight adaptability and quick learning of new languages", "Emphasize distributed systems experience more prominently", "Consider obtaining certification in Ruby or Go", "Add examples of database migration or cross-database projects"], "technicalSkills": {"score": 85, "matched": ["AWS", "PostgreSQL", "Redis", "API development", "distributed systems", "real-time applications", "monitoring", "logging"], "missing": ["Ruby on Rails", "Go Lang", "Java", "DynamoDB", "Cassandra", "GCP", "Azure"], "reasoning": "Strong overlap in cloud and database technologies, with extensive AWS experience. While specific languages differ, candidate shows adaptability with multiple programming languages and frameworks. Strong background in real-time systems and distributed architecture."}}, "resumeQualityScore": 95, "technicalSkillsScore": 85, "experienceAlignmentScore": 90}, "sectionScores": {"softSkills": 88, "achievements": 92, "resumeQuality": 95, "technicalSkills": 85, "experienceAlignment": 90}, "structureScore": 95, "missingKeywords": ["Ruby on Rails", "Go Lang", "Java", "DynamoDB", "Cassandra", "GCP", "Azure"], "skillMatchScore": 0.85, "tailoredContent": {"strengths": ["Extensive real-time systems experience", "Strong AWS expertise", "Proven track record of quantifiable achievements", "Leadership and mentoring capabilities", "Experience with similar scale systems"], "weaknesses": ["Language stack mismatch", "Missing experience with some required databases", "No explicit private cloud experience"], "recommendations": ["Highlight adaptability and quick learning of new languages", "Emphasize distributed systems experience more prominently", "Consider obtaining certification in Ruby or Go", "Add examples of database migration or cross-database projects"]}, "contactInfoScore": 95}	2025-07-23 03:38:13.726361	5264d5df-b3b5-4793-8fa3-736fbea8e31b
48136114-ff73-410e-a61f-1c3ca773917f	\N		About The Role\n\nAs a Senior Software Engineer, you will be a part of the asset monitoring team who can turn product ideas into reality by designing components and services for new feature developments. You will implement scalable architecture and work with an enthusiastic team contributing to robust projects that will be critical for fleets to be able to track everything from trailers down to individual tools at a job site and provide valuable and actionable real-time insights to help streamline operations and increase our customer’s profitability.\n\nWhat You'll Do\n\nCollaborate with several cross functional teams to design and document scalable solutions\nWrite secure, maintainable code that powers the platform that provides real time visibility into company’s assets\nBuild and make scalable design choices for API interfaces to work across internal and external applications and services Build appropriate monitoring, logging, debugging for the health of the system\nActively work on our AWS cloud infrastructure\nMentor and learn from the developers within the engineering organization\n\nWhat We're Looking For\n\nB.S. or M.S. in Computer Science or related field\n5+ years software development experience\nAn affinity for creating software that is extensible, performant, and easy to read\nExperience building product infrastructure, distributed systems and data models\nExperience in Ruby on Rails, Go Lang, Java, or similar language\nExperience with relational and NoSQL databases such as PostgreSQL, DynamoDB, Redis, and Cassandra\nExperience building for Cloud Infrastructure such as AWS, GCP, Azure or private clouds	\N	87	{"matched": {"hardSkills": ["AWS", "PostgreSQL", "Redis", "API development", "distributed systems", "cloud infrastructure", "real-time systems"], "softSkills": ["mentoring", "cross-functional collaboration", "team leadership", "technical documentation", "stakeholder management"], "qualifications": []}, "extracted": {"experience": {"level": "Senior", "years": 7, "reasoning": "Exceeds required 5+ years experience, with directly relevant work in asset monitoring (UTF Labs IoT experience) and real-time systems. Experience with high-volume data operations and scalable architectures aligns well.", "relevance": 90}, "softSkills": {"matched": ["mentoring", "cross-functional collaboration", "team leadership", "technical documentation", "stakeholder management"], "reasoning": "Strong evidence of leadership, mentoring, and cross-functional collaboration across multiple roles. Demonstrates ability to work with various teams and stakeholders."}, "achievements": {"count": 8, "impact": 95, "quality": 92, "reasoning": "Strong quantifiable achievements including 40% reduction in manual intervention, 30% revenue increase, and handling 10,000+ connected devices. Demonstrates clear business impact and technical complexity."}, "technicalSkills": {"score": 85, "matched": ["AWS", "PostgreSQL", "Redis", "API development", "distributed systems", "cloud infrastructure", "real-time systems"], "missing": ["Ruby on Rails", "Go Lang", "Java", "DynamoDB", "Cassandra"], "reasoning": "Strong overlap in cloud and distributed systems expertise, with experience in similar technologies. While specific language requirements differ, candidate shows adaptability with multiple languages and frameworks."}}, "keywordScore": 85, "atsEvaluation": {"confidence": 90, "overallScore": 87, "softSkillsScore": 88, "achievementsScore": 92, "detailedBreakdown": {"redFlags": ["No direct experience with required languages (Ruby, Go, Java)", "Missing experience with some required databases (DynamoDB, Cassandra)"], "strengths": ["Extensive real-time systems experience", "Strong cloud infrastructure expertise", "Proven track record of quantifiable achievements", "Excellent leadership and mentoring experience", "Demonstrated scalability work"], "experience": {"level": "Senior", "years": 7, "reasoning": "Exceeds required 5+ years experience, with directly relevant work in asset monitoring (UTF Labs IoT experience) and real-time systems. Experience with high-volume data operations and scalable architectures aligns well.", "relevance": 90}, "softSkills": {"matched": ["mentoring", "cross-functional collaboration", "team leadership", "technical documentation", "stakeholder management"], "reasoning": "Strong evidence of leadership, mentoring, and cross-functional collaboration across multiple roles. Demonstrates ability to work with various teams and stakeholders."}, "weaknesses": ["Language stack mismatch", "Some missing database technologies", "No explicit mention of monitoring/logging systems"], "achievements": {"count": 8, "impact": 95, "quality": 92, "reasoning": "Strong quantifiable achievements including 40% reduction in manual intervention, 30% revenue increase, and handling 10,000+ connected devices. Demonstrates clear business impact and technical complexity."}, "recommendations": ["Highlight transferable skills from Node.js to Ruby/Go/Java", "Emphasize experience with similar distributed systems", "Add details about monitoring and logging experience", "Consider obtaining certification in missing technologies"], "technicalSkills": {"score": 85, "matched": ["AWS", "PostgreSQL", "Redis", "API development", "distributed systems", "cloud infrastructure", "real-time systems"], "missing": ["Ruby on Rails", "Go Lang", "Java", "DynamoDB", "Cassandra"], "reasoning": "Strong overlap in cloud and distributed systems expertise, with experience in similar technologies. While specific language requirements differ, candidate shows adaptability with multiple languages and frameworks."}}, "resumeQualityScore": 95, "technicalSkillsScore": 85, "experienceAlignmentScore": 90}, "sectionScores": {"softSkills": 88, "achievements": 92, "resumeQuality": 95, "technicalSkills": 85, "experienceAlignment": 90}, "structureScore": 95, "missingKeywords": ["Ruby on Rails", "Go Lang", "Java", "DynamoDB", "Cassandra"], "skillMatchScore": 0.85, "tailoredContent": {"strengths": ["Extensive real-time systems experience", "Strong cloud infrastructure expertise", "Proven track record of quantifiable achievements", "Excellent leadership and mentoring experience", "Demonstrated scalability work"], "weaknesses": ["Language stack mismatch", "Some missing database technologies", "No explicit mention of monitoring/logging systems"], "recommendations": ["Highlight transferable skills from Node.js to Ruby/Go/Java", "Emphasize experience with similar distributed systems", "Add details about monitoring and logging experience", "Consider obtaining certification in missing technologies"]}, "contactInfoScore": 95}	2025-07-23 03:55:19.272068	5264d5df-b3b5-4793-8fa3-736fbea8e31b
\.


--
-- Data for Name: migrations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.migrations (id, "timestamp", name) FROM stdin;
1	1721318400000	FixAtsMatchHistoryUserId1721318400000
2	1721486400000	RefactorCandidateResumeToUserResume1721486400000
4	1721486400001	UpdateFeatureTypeEnum1721486400001
5	1721486400002	AddAtsScoreHistoryRateLimit1721486400002
\.


--
-- Data for Name: rate_limit_configs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.rate_limit_configs (id, plan, user_type, feature_type, monthly_limit, is_active, description, created_at, updated_at) FROM stdin;
d7ce0b41-c7b6-4796-97b7-8e88eb231665	freemium	guest	resume_generation	2	t	Freemium guest users can generate 2 resumes per month	2025-07-12 05:32:17.125977	2025-07-12 05:32:17.125977
0e9c230f-a53f-408d-8848-c1c7d3379d73	freemium	guest	ats_score	5	t	Freemium guest users can check ATS score 5 times per month	2025-07-12 05:32:17.174998	2025-07-12 05:32:17.174998
e9190e0f-9c71-40c9-b7e5-f10498813c9d	freemium	registered	resume_generation	5	t	Freemium registered users can generate 5 resumes per month	2025-07-12 05:32:17.177383	2025-07-12 05:32:17.177383
a380dd06-b9ab-4036-bc98-b89e201822f0	freemium	registered	ats_score	10	t	Freemium registered users can check ATS score 10 times per month	2025-07-12 05:32:17.180431	2025-07-12 05:32:17.180431
ce19cf3a-0b83-46e6-ba53-90686c98bec2	premium	registered	resume_generation	50	t	Premium users can generate 50 resumes per month	2025-07-12 05:32:17.183492	2025-07-12 05:32:17.183492
9529be46-259b-4589-85db-818907820a14	premium	registered	ats_score	100	t	Premium users can check ATS score 100 times per month	2025-07-12 05:32:17.186478	2025-07-12 05:32:17.186478
adff934f-8e86-4bd8-9848-688e5a89a211	freemium	guest	ats_score_history	0	t	Guest users cannot fetch ATS score history	2025-07-23 22:04:23.687811	2025-07-23 22:04:23.687811
d8197ae4-c9fb-4d18-836e-0edd016d919f	freemium	registered	ats_score_history	7	t	Freemium registered users can fetch ATS score history for the last 1 week	2025-07-23 22:04:23.687811	2025-07-23 22:04:23.687811
e369fb8f-e9e0-410a-a85b-1077c3e33f91	premium	registered	ats_score_history	60	t	Premium users can fetch ATS score history for the last 2 months	2025-07-23 22:04:23.687811	2025-07-23 22:04:23.687811
\.


--
-- Data for Name: resume_generations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.resume_generations (id, user_id, guest_id, file_path, original_content, template_id, job_description, company_name, analysis, created_at, "userId", "templateId", tailored_content) FROM stdin;
6bf383e9-a838-4fb7-aec6-68f3fcc5735e	5264d5df-b3b5-4793-8fa3-736fbea8e31b	\N	Fahad_Sabzwari_Senior_Frontend_Engineer.pdf	\n\nFAHAD HASSAN SABZWARI \nfahadsubzwari924@gmail.com | +92 315 841-4969 | linkedin.com/fahadsubzwari/ | Github | Karachi, Pakistan \nPRINCIPLE SOFTWARE ENGINEER | TEAM LEAD FULL STACK \nAward-winning and result-driven Software Engineer with over 7 years of experience, including 3 years in senior-level \nownership  of high-impact backend and  full-stack  projects  using Node.js,  Angular,  and  AWS.  Adept  in  architecting \nmicroservices,  implementing  real-time  applications,  and  leading  cloud-native  deployments  using  Docker,  Redis, \nRabbitMQ/SQS, and CI/CD pipelines. Proven expertise in legacy modernization, high-volume data operations, and \nperformance tuning across MongoDB, PostgreSQL, and MySQL environments. Demonstrates exceptional leadership \nin Agile environments, mentoring teams, aligning software delivery with business strategy, and enforcing engineering \nbest practices. Recognized for technical leadership, analytical depth, cross-functional collaboration, and a relentless \nfocus on code quality, reliability, and platform growth. \nTECHNICAL PROFICIENCIES \nProgramming Languages: JavaScript, TypeScript, Ruby, C# \nFrameworks & Libraries: Angular, Node.js, Express.js, Nest.js, .NET Core \nDatabases: MongoDB, MySQL, PostgreSQL \nCloud & Tools: AWS (EC2, S3, SQS), Docker, WebSocket, Jest, RSpec, CI/CD, Agile, DevOps \nConcepts: Microservices, Micro-Frontends, Domain-Driven Design, REST APIs \nOthers: Information Security Standards, Scrum/Kanban methodologies, Web-app, Testing   \nPROFESSIONAL EXPERIENCE\nFINLEX GMBH, REMOTE APR 2022 – PRESENT \nSENIOR SOFTWARE ENGINEER  \nTools & Technologies: Angular, Node.js, Ruby, AWS (S3, SQS), MongoDB, Jest, RSpec \n• Engineer and deploy a workflow automation feature that reduced manual intervention by 40%, significantly \nfreeing up team capacity for high-impact, strategic initiatives. \n• Orchestrate  the seamless migration  of intricate  legacy feature data into a modernized platform with 95% \naccuracy, sustaining customer confidence and reinforcing long-term satisfaction. \n• Attain a 25% decrease in bug rates through the strategic application of unit and integration tests using Jest \nand RSpec, reinforcing overall code stability. \n• Improve  team  productivity  by  10%  through  mentoring  on  Angular  and  microservices  best  practices,  while \nrefining CI/CD pipelines and conducting pull request reviews to maintain high-quality Agile deliverables. \nLMKR, KARACHI, PAKISTAN OCT 2020 – MAR 2022 \nSOFTWARE DEVELOPMENT ENGINEER  \nTools & Technologies: Angular 14, Node.js (Express), MySQL, AWS (EC2, S3) \n• Achieved a 30% revenue increase and successfully onboarded 10 high-value clients by swiftly delivering MVP \ncore features ahead of schedule, enabling early market entry and stronger competitive positioning. \n• Deployed advanced bidding mechanisms, real-time tracking, and analytical reporting capabilities to elevate \nuser interaction and strengthen client retention. \n\nFAHAD HASSAN SUBZWARI PAGE | 2 \n• Launched  and  configured  applications  on  AWS  EC2  and  S3,  achieving  a  20%  reduction  in  latency  while \nboosting system responsiveness and performance efficiency. \n• Coordinated   with   cross-disciplinary   teams   to   roll   out   feature-rich   deliverables   within   Agile   sprints, \nconsistently meeting project timelines and stakeholder expectations. \nUTF LABS, KARACHI, PAKISTAN APR 2018 – JAN 2020 \nMEAN STACK DEVELOPER  \nTools & Technologies: Angular 12, Node.js (Express), MongoDB, AWS (EC2, S3), WebSocket \n• Constructed dynamic admin portals and interactive dashboards integrated with real-time IoT data streams, \nboosting user engagement by 25% through intuitive data visualization and functionality. \n• Crafted  a  robust  monolith  backend  architecture  with  integrated  WebSocket  communication,  enabling \nseamless live data updates across 10,000+ connected devices. \n• Refactored MongoDB schemas to accommodate high-throughput data operations, cutting query execution \ntimes by 30% and improving overall data retrieval efficiency. \n• Orchestrated  feature  planning  initiatives  to  align  scalable  technical  solutions  with  strategic  business \nobjectives, streamlining development focus and stakeholder alignment. \nSKILL ORBIT, KARACHI, PAKISTAN JUL 2016 – OCT 2017 \nASSOCIATE SOFTWARE ENGINEER  \nTools & Technologies: AngularJS, Ionic, Node.js (Express), MongoDB, MySQL \n• Achieved  a  40%  boost  in  operational  efficiency  by  developing  a  tailored  back-office  admin  panel  for \nautomobile shops, automating order management processes, and streamlining daily operations. \n• Delivered  a  scalable  hybrid  mobile  application  using  Ionic,  streamlining  appointment  scheduling  for  over \n5,000 users through intuitive interfaces and seamless functionality. \n• Constructed high-efficiency REST APIs supporting web and mobile platforms, maintaining 99.9% uptime and \nenabling reliable, cross-platform data exchange at scale. \nEDUCATION \nBACHELOR OF SCIENCE IN COMPUTER SCIENCE \nSir Syed University of Engineering and Technology, Karachi, Pakistan, Aug 2013 – Dec 2017 \nCERTIFICATIONS \nGraphQL: A Primer – Udemy – 2021 \nProblem Solving (Basic) – HackerRank – 2020 \nJavaScript (Basic) – HackerRank – 2020 \nJavaScript for Beginning Web Dev \nAWARDS \nSmart Employee of the Year – UTF Labs – 2019 \nBest Final Year Project – Sir Syed University of Engineering & Technology – 2018 \nBest Employee of the Year – Skill Orbit – 2017 \nStar Head of Web Development Competition – Sir Syed University of Engineering & Technology – 2017 	456a8e23-638d-4b18-9358-285635e1458b	Lead Back-end Engineer:\nTech Stack\nCore: Node.js, MongoDB, AWS (EC2, Lambda, S3, VPC, etc.), Redis, RabbitMQ/SQS;\nTesting: Jest (unit), REST Assured (E2E);\nDevOps: Docker, CI/CD (GitHub Actions/AWS CodePipeline), Load Balancing, VPC networking;\nMonitoring: NewRelic\\Datadog, CloudWatch.\nRequirements\nSolid experience in backend development with Node.js (Express/Nest.js/Fastify) and NoSQL databases (MongoDB).\nHands-on experience with AWS (EC2, S3, Lambda, etc.) and message queues (RabbitMQ/SQS).\nStrong understanding of high-load systems like caching (Redis), concurrency, database sharding, and microservices patterns. \nUnderstanding of data warehousing.\nKnowledge of Jest, API testing (REST Assured/Postman), and TDD/BDD principles.\nFamiliarity with Docker, load balancing, VPCs, and monitoring (CloudWatch/Prometheus). \nAbility to own the backend roadmap, mentor peers, and collaborate across teams.	10Pearls	{"title": "Lead Back-end Engineer", "skills": {"tools": ["AWS", "Docker", "CI/CD", "Jest", "RSpec"], "concepts": ["Microservices", "Domain-Driven Design", "REST APIs"], "databases": ["MongoDB", "MySQL", "PostgreSQL"], "languages": ["JavaScript", "TypeScript", "Ruby", "C#"], "frameworks": ["Node.js", "Express.js", "Nest.js", "Angular"]}, "summary": "Award-winning Software Engineer with over 7 years of experience, specializing in backend and full-stack development. Proven track record in deploying high-impact projects using Node.js, MongoDB, and AWS, achieving significant enhancements in system efficiency and data handling. Experienced in leading teams and aligning software solutions with business strategies.", "metadata": {"missingKeywords": ["AWS (EC2, Lambda, S3, VPC, etc.)", "Node.js", "CI/CD (GitHub Actions/AWS CodePipeline)", "MongoDB", "REST Assured"], "skillMatchScore": 0.2713643490439249}, "education": [{"major": "Computer Science", "degree": "Bachelor of Science", "endDate": "Dec 2017", "startDate": "Aug 2013", "institution": "Sir Syed University of Engineering and Technology"}], "experience": [{"company": "Finlex GmbH", "endDate": "Present", "duration": "Apr 2022 – Present", "location": "Remote", "position": "Senior Software Engineer", "startDate": "Apr 2022", "achievements": ["Improved team productivity by 10% through effective mentoring on Angular and microservices, optimizing CI/CD pipelines for high-quality Agile deliverables."], "technologies": "Angular, Node.js, Ruby, AWS, MongoDB, Jest, RSpec", "responsibilities": ["Engineered and deployed a workflow automation feature, reducing manual intervention by 40%, thus freeing up team capacity for strategic initiatives.", "Orchestrated seamless migration of complex legacy data, achieving 95% accuracy, enhancing customer satisfaction and loyalty.", "Reduced bug rates by 25% by implementing rigorous unit and integration testing, enhancing code stability and reliability."]}, {"company": "LMKR", "endDate": "Mar 2022", "duration": "Oct 2020 – Mar 2022", "location": "Karachi, Pakistan", "position": "Software Development Engineer", "startDate": "Oct 2020", "achievements": [], "technologies": "Angular, Node.js, MySQL, AWS", "responsibilities": ["Delivered MVP core features ahead of schedule, resulting in a 30% revenue increase and acquisition of 10 high-value clients.", "Deployed advanced features enhancing user interaction and client retention.", "Achieved 20% reduction in latency through optimized AWS configurations, enhancing system responsiveness."]}, {"company": "UTF Labs", "endDate": "Jan 2020", "duration": "Apr 2018 – Jan 2020", "location": "Karachi, Pakistan", "position": "MEAN Stack Developer", "startDate": "Apr 2018", "achievements": [], "technologies": "Angular, Node.js, MongoDB, AWS, WebSocket", "responsibilities": ["Constructed dynamic dashboards with real-time IoT data integration, boosting user engagement by 25%.", "Enabled seamless live data updates across 10,000+ devices through robust WebSocket communications.", "Cut query execution times by 30% by refactoring MongoDB schemas, improving data retrieval efficiency."]}], "contactInfo": {"name": "Fahad Hassan Sabzwari", "email": "fahadsubzwari924@gmail.com", "phone": "+92 315 841-4969", "github": "", "linkedin": "linkedin.com/fahadsubzwari/", "location": "Karachi, Pakistan", "portfolio": ""}, "certifications": [{"date": "2021", "name": "GraphQL: A Primer", "issuer": "Udemy", "expiryDate": "", "credentialId": ""}, {"date": "2020", "name": "Problem Solving (Basic)", "issuer": "HackerRank", "expiryDate": "", "credentialId": ""}, {"date": "2020", "name": "JavaScript (Basic)", "issuer": "HackerRank", "expiryDate": "", "credentialId": ""}], "additionalSections": [{"items": ["Smart Employee of the Year – UTF Labs – 2019", "Best Final Year Project – Sir Syed University of Engineering & Technology – 2018", "Best Employee of the Year – Skill Orbit – 2017", "Star Head of Web Development Competition – Sir Syed University of Engineering & Technology – 2017"], "title": "Awards"}]}	2025-07-19 13:23:21.438653	\N	\N	{"title": "Lead Back-end Engineer", "skills": {"tools": ["AWS", "Docker", "CI/CD", "Jest", "RSpec"], "concepts": ["Microservices", "Domain-Driven Design", "REST APIs"], "databases": ["MongoDB", "MySQL", "PostgreSQL"], "languages": ["JavaScript", "TypeScript", "Ruby", "C#"], "frameworks": ["Node.js", "Express.js", "Nest.js", "Angular"]}, "summary": "Award-winning Software Engineer with over 7 years of experience, specializing in backend and full-stack development. Proven track record in deploying high-impact projects using Node.js, MongoDB, and AWS, achieving significant enhancements in system efficiency and data handling. Experienced in leading teams and aligning software solutions with business strategies.", "metadata": {"missingKeywords": ["AWS (EC2, Lambda, S3, VPC, etc.)", "Node.js", "CI/CD (GitHub Actions/AWS CodePipeline)", "MongoDB", "REST Assured"], "skillMatchScore": 0.2713643490439249}, "education": [{"major": "Computer Science", "degree": "Bachelor of Science", "endDate": "Dec 2017", "startDate": "Aug 2013", "institution": "Sir Syed University of Engineering and Technology"}], "experience": [{"company": "Finlex GmbH", "endDate": "Present", "duration": "Apr 2022 – Present", "location": "Remote", "position": "Senior Software Engineer", "startDate": "Apr 2022", "achievements": ["Improved team productivity by 10% through effective mentoring on Angular and microservices, optimizing CI/CD pipelines for high-quality Agile deliverables."], "technologies": "Angular, Node.js, Ruby, AWS, MongoDB, Jest, RSpec", "responsibilities": ["Engineered and deployed a workflow automation feature, reducing manual intervention by 40%, thus freeing up team capacity for strategic initiatives.", "Orchestrated seamless migration of complex legacy data, achieving 95% accuracy, enhancing customer satisfaction and loyalty.", "Reduced bug rates by 25% by implementing rigorous unit and integration testing, enhancing code stability and reliability."]}, {"company": "LMKR", "endDate": "Mar 2022", "duration": "Oct 2020 – Mar 2022", "location": "Karachi, Pakistan", "position": "Software Development Engineer", "startDate": "Oct 2020", "achievements": [], "technologies": "Angular, Node.js, MySQL, AWS", "responsibilities": ["Delivered MVP core features ahead of schedule, resulting in a 30% revenue increase and acquisition of 10 high-value clients.", "Deployed advanced features enhancing user interaction and client retention.", "Achieved 20% reduction in latency through optimized AWS configurations, enhancing system responsiveness."]}, {"company": "UTF Labs", "endDate": "Jan 2020", "duration": "Apr 2018 – Jan 2020", "location": "Karachi, Pakistan", "position": "MEAN Stack Developer", "startDate": "Apr 2018", "achievements": [], "technologies": "Angular, Node.js, MongoDB, AWS, WebSocket", "responsibilities": ["Constructed dynamic dashboards with real-time IoT data integration, boosting user engagement by 25%.", "Enabled seamless live data updates across 10,000+ devices through robust WebSocket communications.", "Cut query execution times by 30% by refactoring MongoDB schemas, improving data retrieval efficiency."]}], "contactInfo": {"name": "Fahad Hassan Sabzwari", "email": "fahadsubzwari924@gmail.com", "phone": "+92 315 841-4969", "github": "", "linkedin": "linkedin.com/fahadsubzwari/", "location": "Karachi, Pakistan", "portfolio": ""}, "certifications": [{"date": "2021", "name": "GraphQL: A Primer", "issuer": "Udemy", "expiryDate": "", "credentialId": ""}, {"date": "2020", "name": "Problem Solving (Basic)", "issuer": "HackerRank", "expiryDate": "", "credentialId": ""}, {"date": "2020", "name": "JavaScript (Basic)", "issuer": "HackerRank", "expiryDate": "", "credentialId": ""}], "additionalSections": [{"items": ["Smart Employee of the Year – UTF Labs – 2019", "Best Final Year Project – Sir Syed University of Engineering & Technology – 2018", "Best Employee of the Year – Skill Orbit – 2017", "Star Head of Web Development Competition – Sir Syed University of Engineering & Technology – 2017"], "title": "Awards"}]}
\.


--
-- Data for Name: resume_templates; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.resume_templates (id, name, key, description, thumbnail_image_url, remote_url, created_at) FROM stdin;
a490d30b-6ddc-4d2f-9391-69a11cdbed7d	Minimalist	minimalist	ATS-friendly template: Minimalist	https://ats-friend-resume-templates-2025.s3.ap-south-1.amazonaws.com/ats-friendly-resume-templates/minimalist/thumbnail.png	https://ats-friend-resume-templates-2025.s3.ap-south-1.amazonaws.com/ats-friendly-resume-templates/minimalist/template.html	2025-06-30 21:36:32.821699
d5efb3d1-7673-4310-b071-395a430c6ac3	Modern	modern	ATS-friendly template: Modern	https://ats-friend-resume-templates-2025.s3.ap-south-1.amazonaws.com/ats-friendly-resume-templates/modern/thumbnail.png	https://ats-friend-resume-templates-2025.s3.ap-south-1.amazonaws.com/ats-friendly-resume-templates/modern/template.html	2025-06-30 21:36:37.909971
456a8e23-638d-4b18-9358-285635e1458b	Professional	professional	ATS-friendly template: Professional	https://ats-friend-resume-templates-2025.s3.ap-south-1.amazonaws.com/ats-friendly-resume-templates/professional/thumbnail.png	https://ats-friend-resume-templates-2025.s3.ap-south-1.amazonaws.com/ats-friendly-resume-templates/professional/template.html	2025-06-30 21:36:44.788635
\.


--
-- Data for Name: usage_tracking; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.usage_tracking (id, user_id, guest_id, ip_address, feature_type, month, year, usage_count, created_at, last_used_at, "userId") FROM stdin;
1604d068-50bb-453a-9e64-3204ac48f1ea	\N	89ddfa6b-ca67-4bc3-9cda-cb7ba8b1f558	::1	ats_score	7	2025	5	2025-07-12 05:58:52.286479	2025-07-12 06:32:12.601	\N
f86f50e5-a887-44b5-8e1e-b9fe0ff386b7	5264d5df-b3b5-4793-8fa3-736fbea8e31b	\N		resume_generation	7	2025	1	2025-07-19 13:23:21.51858	2025-07-19 13:23:21.501	\N
616defaa-edbf-4d69-b96c-d90331ef165b	5264d5df-b3b5-4793-8fa3-736fbea8e31b	\N		ats_score	7	2025	6	2025-07-16 21:45:45.986351	2025-07-23 03:55:19.289	\N
\.


--
-- Data for Name: user_resumes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_resumes (id, "fileName", "fileSize", "mimeType", "s3Url", "isActive", user_id, "createdAt", "updatedAt") FROM stdin;
bb50ec72-080f-4d23-b5e3-17d693476395	Fahad_Sabzwari_Senior_Frontend_Engineer.pdf	86660	application/pdf	https://af-candidates-resumes.s3.ap-south-1.amazonaws.com/5264d5df-b3b5-4793-8fa3-736fbea8e31b-1753223671347-Fahad_Sabzwari_Senior_Frontend_Engineer.pdf	t	5264d5df-b3b5-4793-8fa3-736fbea8e31b	2025-07-23 03:34:32.610018	2025-07-23 03:34:32.610018
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, full_name, email, password, plan, user_type, guest_id, ip_address, user_agent, is_active, created_at, updated_at) FROM stdin;
4424025d-e5b1-4368-9ad3-0a8f4cc6b384	Guest_User_89ddfa6b-ca67-4bc3-9cda-cb7ba8b1f558	guest-89ddfa6b-ca67-4bc3-9cda-cb7ba8b1f558@ats-fit.com		freemium	guest	89ddfa6b-ca67-4bc3-9cda-cb7ba8b1f558	::1	PostmanRuntime/7.37.3	t	2025-07-12 05:58:39.010339	2025-07-12 05:58:39.010339
5264d5df-b3b5-4793-8fa3-736fbea8e31b	Fahad Subzwari	fahadsubzwari924@gmail.com	$2b$10$uG3YmPXN63ZX.7HrldulCOjKekqX9fOTWFr9vCUmhM8KURCcjtQrK	premium	registered	\N	\N	\N	t	2025-07-12 05:32:16.999707	2025-07-12 05:32:16.999707
\.


--
-- Name: migrations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.migrations_id_seq', 5, true);


--
-- Name: usage_tracking PK_2879a43395bb513204f88769aa6; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usage_tracking
    ADD CONSTRAINT "PK_2879a43395bb513204f88769aa6" PRIMARY KEY (id);


--
-- Name: ats_match_histories PK_3af70cbbedfe22776f2078f4cac; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ats_match_histories
    ADD CONSTRAINT "PK_3af70cbbedfe22776f2078f4cac" PRIMARY KEY (id);


--
-- Name: resume_generations PK_7321601531e8496ff1310321107; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resume_generations
    ADD CONSTRAINT "PK_7321601531e8496ff1310321107" PRIMARY KEY (id);


--
-- Name: migrations PK_8c82d7f526340ab734260ea46be; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.migrations
    ADD CONSTRAINT "PK_8c82d7f526340ab734260ea46be" PRIMARY KEY (id);


--
-- Name: users PK_a3ffb1c0c8416b9fc6f907b7433; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY (id);


--
-- Name: resume_templates PK_af47d154a6b5ab9c6d169c56a83; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resume_templates
    ADD CONSTRAINT "PK_af47d154a6b5ab9c6d169c56a83" PRIMARY KEY (id);


--
-- Name: rate_limit_configs PK_b030bece4024127ec07005697da; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rate_limit_configs
    ADD CONSTRAINT "PK_b030bece4024127ec07005697da" PRIMARY KEY (id);


--
-- Name: user_resumes PK_user_resumes_id; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_resumes
    ADD CONSTRAINT "PK_user_resumes_id" PRIMARY KEY (id);


--
-- Name: resume_templates UQ_3557a3d8d510490a3bbb8a2532f; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resume_templates
    ADD CONSTRAINT "UQ_3557a3d8d510490a3bbb8a2532f" UNIQUE (key);


--
-- Name: users UQ_97672ac88f789774dd47f7c8be3; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE (email);


--
-- Name: IDX_4c8f4f5a55135dece756b70f2f; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_4c8f4f5a55135dece756b70f2f" ON public.usage_tracking USING btree (user_id, feature_type, month, year);


--
-- Name: IDX_58394bc638089670195fcc9bf5; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_58394bc638089670195fcc9bf5" ON public.usage_tracking USING btree (guest_id, feature_type, month, year);


--
-- Name: IDX_c5674532bcf2890f0cc6381ab0; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "IDX_c5674532bcf2890f0cc6381ab0" ON public.rate_limit_configs USING btree (plan, user_type, feature_type);


--
-- Name: IDX_df86c9490cd1a45431d9612d6b; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_df86c9490cd1a45431d9612d6b" ON public.usage_tracking USING btree (ip_address, feature_type, month, year);


--
-- Name: ats_match_histories FK_3b4d57a6545551fff0be85fea54; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ats_match_histories
    ADD CONSTRAINT "FK_3b4d57a6545551fff0be85fea54" FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: resume_generations FK_5a70821e432250ee40bc8bd434a; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resume_generations
    ADD CONSTRAINT "FK_5a70821e432250ee40bc8bd434a" FOREIGN KEY ("userId") REFERENCES public.users(id);


--
-- Name: usage_tracking FK_5d8df20d681cd50fcde4db2db32; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usage_tracking
    ADD CONSTRAINT "FK_5d8df20d681cd50fcde4db2db32" FOREIGN KEY ("userId") REFERENCES public.users(id);


--
-- Name: resume_generations FK_8f064d32d49a6edb2cfd4960da9; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.resume_generations
    ADD CONSTRAINT "FK_8f064d32d49a6edb2cfd4960da9" FOREIGN KEY ("templateId") REFERENCES public.resume_templates(id);


--
-- Name: user_resumes FK_d9194b75eda937baf47f31a0c64; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_resumes
    ADD CONSTRAINT "FK_d9194b75eda937baf47f31a0c64" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

