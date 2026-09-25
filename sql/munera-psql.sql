--
-- PostgreSQL database dump
--

-- Dumped from database version 15.5
-- Dumped by pg_dump version 17.0

-- Started on 2026-09-25 13:30:02

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 19 (class 2615 OID 28136333)
-- Name: munera; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA munera;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 468 (class 1259 OID 28136502)
-- Name: audit; Type: TABLE; Schema: munera; Owner: -
--

CREATE TABLE munera.audit (
    id integer NOT NULL,
    action character varying NOT NULL,
    job_id bigint,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 467 (class 1259 OID 28136501)
-- Name: audit_id_seq; Type: SEQUENCE; Schema: munera; Owner: -
--

CREATE SEQUENCE munera.audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3938 (class 0 OID 0)
-- Dependencies: 467
-- Name: audit_id_seq; Type: SEQUENCE OWNED BY; Schema: munera; Owner: -
--

ALTER SEQUENCE munera.audit_id_seq OWNED BY munera.audit.id;


--
-- TOC entry 466 (class 1259 OID 28136482)
-- Name: executions; Type: TABLE; Schema: munera; Owner: -
--

CREATE TABLE munera.executions (
    id integer NOT NULL,
    job_id bigint,
    job_name character varying NOT NULL,
    script_path text NOT NULL,
    trigger character varying NOT NULL,
    status character varying,
    pid integer,
    exit_code integer,
    signal character varying,
    error_message text,
    log_path text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone
);


--
-- TOC entry 465 (class 1259 OID 28136481)
-- Name: executions_id_seq; Type: SEQUENCE; Schema: munera; Owner: -
--

CREATE SEQUENCE munera.executions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3939 (class 0 OID 0)
-- Dependencies: 465
-- Name: executions_id_seq; Type: SEQUENCE OWNED BY; Schema: munera; Owner: -
--

ALTER SEQUENCE munera.executions_id_seq OWNED BY munera.executions.id;


--
-- TOC entry 464 (class 1259 OID 28136444)
-- Name: job_schedules; Type: TABLE; Schema: munera; Owner: -
--

CREATE TABLE munera.job_schedules (
    id integer NOT NULL,
    job_id bigint NOT NULL,
    time_hhmm character varying,
    next_run_at timestamp with time zone NOT NULL,
    datetime timestamp without time zone,
    period bigint
);


--
-- TOC entry 463 (class 1259 OID 28136443)
-- Name: job_schedules_id_seq; Type: SEQUENCE; Schema: munera; Owner: -
--

CREATE SEQUENCE munera.job_schedules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3940 (class 0 OID 0)
-- Dependencies: 463
-- Name: job_schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: munera; Owner: -
--

ALTER SEQUENCE munera.job_schedules_id_seq OWNED BY munera.job_schedules.id;


--
-- TOC entry 462 (class 1259 OID 28136390)
-- Name: jobs; Type: TABLE; Schema: munera; Owner: -
--

CREATE TABLE munera.jobs (
    id integer NOT NULL,
    name character varying NOT NULL,
    script_path text NOT NULL,
    args jsonb DEFAULT '[]'::jsonb NOT NULL,
    env jsonb DEFAULT '{}'::jsonb NOT NULL,
    times text[] NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    timeout_seconds integer DEFAULT 3600 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT jobs_timeout_seconds_check CHECK (((timeout_seconds >= 1) AND (timeout_seconds <= 86400)))
);


--
-- TOC entry 461 (class 1259 OID 28136389)
-- Name: jobs_id_seq; Type: SEQUENCE; Schema: munera; Owner: -
--

CREATE SEQUENCE munera.jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- TOC entry 3941 (class 0 OID 0)
-- Dependencies: 461
-- Name: jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: munera; Owner: -
--

ALTER SEQUENCE munera.jobs_id_seq OWNED BY munera.jobs.id;


--
-- TOC entry 3766 (class 2604 OID 28136505)
-- Name: audit id; Type: DEFAULT; Schema: munera; Owner: -
--

ALTER TABLE ONLY munera.audit ALTER COLUMN id SET DEFAULT nextval('munera.audit_id_seq'::regclass);


--
-- TOC entry 3764 (class 2604 OID 28136485)
-- Name: executions id; Type: DEFAULT; Schema: munera; Owner: -
--

ALTER TABLE ONLY munera.executions ALTER COLUMN id SET DEFAULT nextval('munera.executions_id_seq'::regclass);


--
-- TOC entry 3763 (class 2604 OID 28136447)
-- Name: job_schedules id; Type: DEFAULT; Schema: munera; Owner: -
--

ALTER TABLE ONLY munera.job_schedules ALTER COLUMN id SET DEFAULT nextval('munera.job_schedules_id_seq'::regclass);


--
-- TOC entry 3756 (class 2604 OID 28136393)
-- Name: jobs id; Type: DEFAULT; Schema: munera; Owner: -
--

ALTER TABLE ONLY munera.jobs ALTER COLUMN id SET DEFAULT nextval('munera.jobs_id_seq'::regclass);


--
-- TOC entry 3932 (class 0 OID 28136502)
-- Dependencies: 468
-- Data for Name: audit; Type: TABLE DATA; Schema: munera; Owner: -
--

COPY munera.audit (id, action, job_id, details, created_at) FROM stdin;
1	job.upsert	1	{"script": "C:\\\\xampp\\\\htdocs\\\\cgrs\\\\munera-task-flow\\\\scripts\\\\exemplo.bat", "schedule": ["18:55"]}	2026-09-23 18:54:38.348555-03
2	job.delete	1	{}	2026-09-23 19:05:07.445412-03
3	job.upsert	2	{"script": "C:\\\\xampp\\\\htdocs\\\\cgrs\\\\munera-task-flow\\\\scripts\\\\exemplo.bat", "schedule": ["19:16"]}	2026-09-23 19:15:05.498299-03
4	job.upsert	3	{"script": "C:\\\\xampp\\\\htdocs\\\\cgrs\\\\munera-task-flow\\\\scripts\\\\exemplo.php", "schedule": ["19:31"]}	2026-09-23 19:30:14.63065-03
5	job.delete	3	{}	2026-09-23 20:09:10.021994-03
6	job.delete	2	{}	2026-09-23 20:09:12.638235-03
7	job.upsert	4	{"script": "C:\\\\xampp\\\\htdocs\\\\cgrs\\\\munera-task-flow\\\\scripts\\\\exemplo.js", "schedule": ["09:37", "22:00"]}	2026-09-23 20:10:17.707436-03
8	job.delete	4	{}	2026-09-23 20:11:12.321821-03
9	job.upsert	5	{"script": "C:\\\\xampp\\\\htdocs\\\\cgrs\\\\munera-task-flow\\\\scripts\\\\exemplo.js", "schedule": ["09:37", "22:00"]}	2026-09-23 20:11:17.476909-03
10	job.upsert	6	{"period": "1", "script": "C:\\\\xampp\\\\htdocs\\\\cgrs\\\\munera-task-flow\\\\scripts\\\\exemplo.bat", "datetime": "2026-09-25T15:56:00.000Z", "schedule": []}	2026-09-25 12:55:02.191463-03
11	job.upsert	7	{"period": null, "script": "/var/www/script/munera-task-flow/scripts/teste-servidor.js", "datetime": null, "schedule": ["13:10", "13:12"]}	2026-09-25 13:08:49.759518-03
\.


--
-- TOC entry 3930 (class 0 OID 28136482)
-- Dependencies: 466
-- Data for Name: executions; Type: TABLE DATA; Schema: munera; Owner: -
--

COPY munera.executions (id, job_id, job_name, script_path, trigger, status, pid, exit_code, signal, error_message, log_path, started_at, finished_at) FROM stdin;
20	7	teste-servidor	/var/www/script/munera-task-flow/scripts/teste-servidor.js	schedule 13:12	success	2134491	0	\N	\N	/var/www/script/munera-task-flow/src/log/teste-servidor-7/log-2026-09-25T16-11-56-787Z-2133622.txt	2026-09-25 13:12:03.377713-03	2026-09-25 13:12:05.444498-03
1	1	exemplo	C:\\xampp\\htdocs\\cgrs\\munera-task-flow\\scripts\\exemplo.bat	schedule 18:55	failed	28080	1	\N	\N	C:\\xampp\\htdocs\\cgrs\\munera-task-flow\\src\\log\\exemplo-1\\log-2026-09-23T21-55-00-311Z-28868.txt	2026-09-23 18:55:00.247396-03	2026-09-23 18:55:00.28039-03
13	7	teste-servidor	/var/www/script/munera-task-flow/scripts/teste-servidor.js	schedule 13:10	skipped	\N	\N	\N	already_running_or_capacity	\N	2026-09-25 13:10:04.259651-03	2026-09-25 13:10:04.259651-03
2	2	exemplo	C:\\xampp\\htdocs\\cgrs\\munera-task-flow\\scripts\\exemplo.bat	schedule 19:16	success	28644	0	\N	\N	C:\\xampp\\htdocs\\cgrs\\munera-task-flow\\src\\log\\exemplo-2\\log-2026-09-23T22-16-00-379Z-25972.txt	2026-09-23 19:16:00.310996-03	2026-09-23 19:16:00.349423-03
14	7	teste-servidor	/var/www/script/munera-task-flow/scripts/teste-servidor.js	schedule 13:10	skipped	\N	\N	\N	already_running_or_capacity	\N	2026-09-25 13:10:05.258363-03	2026-09-25 13:10:05.258363-03
3	3	exemplo	C:\\xampp\\htdocs\\cgrs\\munera-task-flow\\scripts\\exemplo.php	schedule 19:31	success	27488	0	\N	\N	C:\\xampp\\htdocs\\cgrs\\munera-task-flow\\src\\log\\exemplo-3\\log-2026-09-23T22-31-00-121Z-24652.txt	2026-09-23 19:31:00.055972-03	2026-09-23 19:31:00.503913-03
12	7	teste-servidor	/var/www/script/munera-task-flow/scripts/teste-servidor.js	schedule 13:10	success	2134435	0	\N	\N	/var/www/script/munera-task-flow/src/log/teste-servidor-7/log-2026-09-25T16-09-56-673Z-2133622.txt	2026-09-25 13:10:03.257265-03	2026-09-25 13:10:05.319878-03
4	5	exemplo	C:\\xampp\\htdocs\\cgrs\\munera-task-flow\\scripts\\exemplo.js	schedule 22:00	success	26852	0	\N	\N	C:\\xampp\\htdocs\\cgrs\\munera-task-flow\\src\\log\\exemplo-5\\log-2026-09-24T01-00-00-443Z-6060.txt	2026-09-23 22:00:00.591697-03	2026-09-23 22:00:02.700245-03
5	5	exemplo	C:\\xampp\\htdocs\\cgrs\\munera-task-flow\\scripts\\exemplo.js	schedule 09:37	success	5128	0	\N	\N	C:\\xampp\\htdocs\\cgrs\\munera-task-flow\\src\\log\\exemplo-5\\log-2026-09-24T12-37-00-383Z-6060.txt	2026-09-24 09:37:00.619042-03	2026-09-24 09:37:02.77745-03
6	5	exemplo	C:\\xampp\\htdocs\\cgrs\\munera-task-flow\\scripts\\exemplo.js	schedule 22:00	success	16564	0	\N	\N	C:\\xampp\\htdocs\\cgrs\\munera-task-flow\\src\\log\\exemplo-5\\log-2026-09-25T01-00-00-097Z-6060.txt	2026-09-24 22:00:00.337485-03	2026-09-24 22:00:02.447809-03
16	7	teste-servidor	/var/www/script/munera-task-flow/scripts/teste-servidor.js	schedule 13:10	skipped	\N	\N	\N	already_running_or_capacity	\N	2026-09-25 13:10:07.260874-03	2026-09-25 13:10:07.260874-03
7	5	exemplo	C:\\xampp\\htdocs\\cgrs\\munera-task-flow\\scripts\\exemplo.js	schedule 09:37	success	30508	0	\N	\N	C:\\xampp\\htdocs\\cgrs\\munera-task-flow\\src\\log\\exemplo-5\\log-2026-09-25T12-37-00-632Z-6060.txt	2026-09-25 09:37:01.015043-03	2026-09-25 09:37:03.241539-03
15	7	teste-servidor	/var/www/script/munera-task-flow/scripts/teste-servidor.js	schedule 13:10	success	2134446	0	\N	\N	/var/www/script/munera-task-flow/src/log/teste-servidor-7/log-2026-09-25T16-09-59-676Z-2133622.txt	2026-09-25 13:10:06.260685-03	2026-09-25 13:10:08.328952-03
8	6	exemplo	C:\\xampp\\htdocs\\cgrs\\munera-task-flow\\scripts\\exemplo.bat	datetime 25/09/2026, 12:56:00 period=1d	success	12788	0	\N	\N	C:\\xampp\\htdocs\\cgrs\\munera-task-flow\\src\\log\\exemplo-6\\log-2026-09-25T15-56-00-364Z-30708.txt	2026-09-25 12:56:00.777615-03	2026-09-25 12:56:00.821907-03
10	7	teste-servidor	/var/www/script/munera-task-flow/scripts/teste-servidor.js	schedule 13:10	skipped	\N	\N	\N	already_running_or_capacity	\N	2026-09-25 13:10:01.255614-03	2026-09-25 13:10:01.255614-03
11	7	teste-servidor	/var/www/script/munera-task-flow/scripts/teste-servidor.js	schedule 13:10	skipped	\N	\N	\N	already_running_or_capacity	\N	2026-09-25 13:10:02.255347-03	2026-09-25 13:10:02.255347-03
9	7	teste-servidor	/var/www/script/munera-task-flow/scripts/teste-servidor.js	schedule 13:10	success	2134424	0	\N	\N	/var/www/script/munera-task-flow/src/log/teste-servidor-7/log-2026-09-25T16-09-53-674Z-2133622.txt	2026-09-25 13:10:00.259641-03	2026-09-25 13:10:02.332072-03
18	7	teste-servidor	/var/www/script/munera-task-flow/scripts/teste-servidor.js	schedule 13:12	skipped	\N	\N	\N	already_running_or_capacity	\N	2026-09-25 13:12:01.375764-03	2026-09-25 13:12:01.375764-03
19	7	teste-servidor	/var/www/script/munera-task-flow/scripts/teste-servidor.js	schedule 13:12	skipped	\N	\N	\N	already_running_or_capacity	\N	2026-09-25 13:12:02.381217-03	2026-09-25 13:12:02.381217-03
17	7	teste-servidor	/var/www/script/munera-task-flow/scripts/teste-servidor.js	schedule 13:12	success	2134478	0	\N	\N	/var/www/script/munera-task-flow/src/log/teste-servidor-7/log-2026-09-25T16-11-53-784Z-2133622.txt	2026-09-25 13:12:00.373896-03	2026-09-25 13:12:02.442336-03
21	7	teste-servidor	/var/www/script/munera-task-flow/scripts/teste-servidor.js	schedule 13:12	skipped	\N	\N	\N	already_running_or_capacity	\N	2026-09-25 13:12:04.37841-03	2026-09-25 13:12:04.37841-03
22	7	teste-servidor	/var/www/script/munera-task-flow/scripts/teste-servidor.js	schedule 13:12	skipped	\N	\N	\N	already_running_or_capacity	\N	2026-09-25 13:12:05.380345-03	2026-09-25 13:12:05.380345-03
24	7	teste-servidor	/var/www/script/munera-task-flow/scripts/teste-servidor.js	schedule 13:12	skipped	\N	\N	\N	already_running_or_capacity	\N	2026-09-25 13:12:07.381996-03	2026-09-25 13:12:07.381996-03
23	7	teste-servidor	/var/www/script/munera-task-flow/scripts/teste-servidor.js	schedule 13:12	success	2134502	0	\N	\N	/var/www/script/munera-task-flow/src/log/teste-servidor-7/log-2026-09-25T16-11-59-789Z-2133622.txt	2026-09-25 13:12:06.380082-03	2026-09-25 13:12:08.442839-03
\.


--
-- TOC entry 3928 (class 0 OID 28136444)
-- Dependencies: 464
-- Data for Name: job_schedules; Type: TABLE DATA; Schema: munera; Owner: -
--

COPY munera.job_schedules (id, job_id, time_hhmm, next_run_at, datetime, period) FROM stdin;
7	5	22:00	2026-09-25 22:00:00-03	\N	\N
6	5	09:37	2026-09-26 09:37:00-03	\N	\N
8	6	\N	2026-09-26 12:56:00-03	2026-09-25 12:56:00	1
9	7	13:10	2026-09-26 13:10:00-03	\N	\N
10	7	13:12	2026-09-26 13:12:00-03	\N	\N
\.


--
-- TOC entry 3926 (class 0 OID 28136390)
-- Dependencies: 462
-- Data for Name: jobs; Type: TABLE DATA; Schema: munera; Owner: -
--

COPY munera.jobs (id, name, script_path, args, env, times, enabled, timeout_seconds, created_at, updated_at) FROM stdin;
5	exemplo	C:\\xampp\\htdocs\\cgrs\\munera-task-flow\\scripts\\exemplo.js	[]	{}	{09:37,22:00}	t	3600	2026-09-23 20:11:17.465543-03	2026-09-23 20:11:17.465543-03
6	exemplo	C:\\xampp\\htdocs\\cgrs\\munera-task-flow\\scripts\\exemplo.bat	[]	{}	{}	t	3600	2026-09-25 12:55:02.15554-03	2026-09-25 12:55:02.15554-03
7	teste-servidor	/var/www/script/munera-task-flow/scripts/teste-servidor.js	[]	{}	{13:10,13:12}	t	3600	2026-09-25 13:08:49.748262-03	2026-09-25 13:08:49.748262-03
\.


--
-- TOC entry 3942 (class 0 OID 0)
-- Dependencies: 467
-- Name: audit_id_seq; Type: SEQUENCE SET; Schema: munera; Owner: -
--

SELECT pg_catalog.setval('munera.audit_id_seq', 11, true);


--
-- TOC entry 3943 (class 0 OID 0)
-- Dependencies: 465
-- Name: executions_id_seq; Type: SEQUENCE SET; Schema: munera; Owner: -
--

SELECT pg_catalog.setval('munera.executions_id_seq', 24, true);


--
-- TOC entry 3944 (class 0 OID 0)
-- Dependencies: 463
-- Name: job_schedules_id_seq; Type: SEQUENCE SET; Schema: munera; Owner: -
--

SELECT pg_catalog.setval('munera.job_schedules_id_seq', 10, true);


--
-- TOC entry 3945 (class 0 OID 0)
-- Dependencies: 461
-- Name: jobs_id_seq; Type: SEQUENCE SET; Schema: munera; Owner: -
--

SELECT pg_catalog.setval('munera.jobs_id_seq', 7, true);


--
-- TOC entry 3779 (class 2606 OID 28136511)
-- Name: audit audit_pk; Type: CONSTRAINT; Schema: munera; Owner: -
--

ALTER TABLE ONLY munera.audit
    ADD CONSTRAINT audit_pk PRIMARY KEY (id);


--
-- TOC entry 3777 (class 2606 OID 28136490)
-- Name: executions executions_pk; Type: CONSTRAINT; Schema: munera; Owner: -
--

ALTER TABLE ONLY munera.executions
    ADD CONSTRAINT executions_pk PRIMARY KEY (id);


--
-- TOC entry 3773 (class 2606 OID 28136449)
-- Name: job_schedules job_schedules_pk; Type: CONSTRAINT; Schema: munera; Owner: -
--

ALTER TABLE ONLY munera.job_schedules
    ADD CONSTRAINT job_schedules_pk PRIMARY KEY (id);


--
-- TOC entry 3775 (class 2606 OID 28136466)
-- Name: job_schedules job_schedules_unique; Type: CONSTRAINT; Schema: munera; Owner: -
--

ALTER TABLE ONLY munera.job_schedules
    ADD CONSTRAINT job_schedules_unique UNIQUE (job_id, time_hhmm);


--
-- TOC entry 3771 (class 2606 OID 28136404)
-- Name: jobs jobs_pk; Type: CONSTRAINT; Schema: munera; Owner: -
--

ALTER TABLE ONLY munera.jobs
    ADD CONSTRAINT jobs_pk PRIMARY KEY (id);


-- Completed on 2026-09-25 13:30:04

--
-- PostgreSQL database dump complete
--

