--
-- PostgreSQL database dump
--


-- Dumped from database version 17.10
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', 'public', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: gen_code_trg(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gen_code_trg() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  prefix  text := TG_ARGV[0];
  width   int  := TG_ARGV[1]::int;
  colname text := TG_ARGV[2];
  cur     text;
  nextn   int;
  rec     jsonb;
BEGIN
  rec := to_jsonb(NEW);
  cur := rec->>colname;
  IF cur IS NULL OR cur = '' THEN
    EXECUTE format(
      'SELECT COALESCE(MAX(NULLIF(regexp_replace(%I, ''[^0-9]'', '''', ''g''), '''')::int), 0) + 1 FROM %I',
      colname, TG_TABLE_NAME
    ) INTO nextn;
    rec := jsonb_set(rec, ARRAY[colname], to_jsonb(prefix || lpad(nextn::text, width, '0')));
    NEW := jsonb_populate_record(NEW, rec);
  END IF;
  RETURN NEW;
END
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


--
-- Name: bom_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bom_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: bom_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bom_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bom_id uuid NOT NULL,
    material_id uuid NOT NULL,
    quantity numeric(14,4) DEFAULT 0 NOT NULL,
    unit character varying(30),
    ratio_percent numeric(7,3),
    line_no integer DEFAULT 1 NOT NULL,
    note text
);


--
-- Name: boms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.boms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bom_code character varying(30) NOT NULL,
    product_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    bom_type character varying(30) DEFAULT 'Định mức NVL'::character varying NOT NULL,
    output_quantity numeric(14,3) DEFAULT 1 NOT NULL,
    output_unit character varying(30),
    status character varying(20) DEFAULT 'Hoạt động'::character varying NOT NULL,
    note text,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    process_id uuid,
    CONSTRAINT boms_bom_type_check CHECK (((bom_type)::text = ANY ((ARRAY['Định mức NVL'::character varying, 'Công thức pha màu'::character varying])::text[]))),
    CONSTRAINT boms_status_check CHECK (((status)::text = ANY ((ARRAY['Hoạt động'::character varying, 'Không hoạt động'::character varying])::text[])))
);


--
-- Name: customer_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_code character varying(30) NOT NULL,
    name character varying(255) NOT NULL,
    customer_type character varying(20) DEFAULT 'Khách sỉ'::character varying NOT NULL,
    phone character varying(30),
    email character varying(150),
    address text,
    status character varying(20) DEFAULT 'Hoạt động'::character varying NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customers_customer_type_check CHECK (((customer_type)::text = ANY ((ARRAY['Khách sỉ'::character varying, 'Khách lẻ'::character varying])::text[]))),
    CONSTRAINT customers_status_check CHECK (((status)::text = ANY ((ARRAY['Hoạt động'::character varying, 'Không hoạt động'::character varying])::text[])))
);


--
-- Name: delivery_note_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_note_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    delivery_note_id uuid NOT NULL,
    product_id uuid,
    product_name character varying(255),
    specs jsonb DEFAULT '{}'::jsonb NOT NULL,
    quantity numeric(14,2) DEFAULT 0 NOT NULL,
    unit character varying(30),
    unit_price numeric(16,2) DEFAULT 0 NOT NULL,
    amount numeric(16,2) DEFAULT 0 NOT NULL,
    line_no integer
);


--
-- Name: delivery_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    note_code character varying(30),
    sales_order_id uuid,
    customer_id uuid,
    delivery_date date,
    status character varying(40) DEFAULT 'Đã xuất hóa đơn'::character varying NOT NULL,
    note text,
    total_amount numeric(16,2) DEFAULT 0 NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_amount numeric(16,2) DEFAULT 0 NOT NULL,
    CONSTRAINT delivery_notes_status_check CHECK (((status)::text = ANY ((ARRAY['Bản nháp'::character varying, 'Giao hàng'::character varying, 'Đã xuất hóa đơn'::character varying, 'Chờ thanh toán'::character varying, 'Đã thanh toán 1 phần'::character varying, 'Đã thanh toán'::character varying, 'Đã hủy'::character varying])::text[])))
);


--
-- Name: employee_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employee_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_code character varying(20) NOT NULL,
    name character varying(150) NOT NULL,
    factory character varying(50),
    "position" character varying(100),
    skill_level character varying(30),
    phone character varying(30),
    status character varying(20) DEFAULT 'Hoạt động'::character varying NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT employees_status_check CHECK (((status)::text = ANY ((ARRAY['Hoạt động'::character varying, 'Không hoạt động'::character varying])::text[])))
);


--
-- Name: inventory_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_stock (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    location_id uuid,
    attr_size character varying(100) DEFAULT ''::character varying NOT NULL,
    attr_thickness character varying(100) DEFAULT ''::character varying NOT NULL,
    attr_color character varying(100) DEFAULT ''::character varying NOT NULL,
    quantity numeric(14,2) DEFAULT 0 NOT NULL,
    unit character varying(30),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expiry_date date,
    counted_qty numeric(14,2),
    counted_date date,
    specs jsonb DEFAULT '{}'::jsonb NOT NULL,
    spec_key text DEFAULT ''::text NOT NULL,
    lot_code character varying(40) DEFAULT ''::character varying NOT NULL,
    prod_order_id uuid
);


--
-- Name: inventory_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    location_id uuid,
    trx_type character varying(20) NOT NULL,
    quantity numeric(14,2) NOT NULL,
    attr_size character varying(100) DEFAULT ''::character varying,
    attr_thickness character varying(100) DEFAULT ''::character varying,
    attr_color character varying(100) DEFAULT ''::character varying,
    ref_code character varying(50),
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    specs jsonb DEFAULT '{}'::jsonb NOT NULL,
    spec_key text DEFAULT ''::text NOT NULL,
    lot_code character varying(40) DEFAULT ''::character varying NOT NULL,
    CONSTRAINT inventory_transactions_trx_type_check CHECK (((trx_type)::text = ANY ((ARRAY['Nhập'::character varying, 'Xuất'::character varying, 'Điều chỉnh'::character varying])::text[])))
);


--
-- Name: location_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.location_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    warehouse_id uuid NOT NULL,
    location_code character varying(30) NOT NULL,
    name character varying(150) NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    zone_id uuid
);


--
-- Name: machine_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.machine_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: machines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.machines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    machine_code character varying(30) NOT NULL,
    name character varying(150) NOT NULL,
    factory character varying(50) NOT NULL,
    machine_type character varying(50),
    status character varying(20) DEFAULT 'Hoạt động'::character varying NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    capacity_per_hour numeric(10,2) DEFAULT 0,
    expected_lifespan_hours numeric(14,2) DEFAULT 0,
    installation_date date DEFAULT CURRENT_DATE,
    CONSTRAINT machines_factory_check CHECK (((factory)::text = ANY ((ARRAY['Nhà máy thổi'::character varying, 'Nhà máy cắt'::character varying])::text[]))),
    CONSTRAINT machines_status_check CHECK (((status)::text = ANY ((ARRAY['Hoạt động'::character varying, 'Bảo trì'::character varying, 'Ngừng'::character varying])::text[])))
);


--
-- Name: outbound_slip_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbound_slip_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slip_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity numeric DEFAULT 0 NOT NULL,
    unit character varying,
    lot_code character varying DEFAULT ''::character varying,
    note text
);


--
-- Name: outbound_slips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outbound_slips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slip_code character varying,
    slip_date date DEFAULT CURRENT_DATE,
    purpose character varying,
    location_id uuid,
    prod_order_id uuid,
    status character varying DEFAULT 'Chờ xuất'::character varying,
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    confirmed_at timestamp with time zone
);


--
-- Name: process_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.process_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: process_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.process_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    process_id uuid NOT NULL,
    seq integer DEFAULT 1 NOT NULL,
    name character varying(100) NOT NULL,
    machine_type character varying(80),
    input_product_id uuid,
    output_product_id uuid,
    yield_percent numeric(7,3),
    scrap_percent numeric(7,3),
    note text,
    workshop character varying(100),
    machine_id uuid,
    input_product_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    duration_minutes numeric(12,2),
    inputs jsonb DEFAULT '[]'::jsonb NOT NULL,
    output_quantity numeric(14,2),
    output_unit character varying(30),
    machine_ids jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: prod_order_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.prod_order_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: product_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    name character varying(255),
    content_type character varying(120),
    is_image boolean DEFAULT false NOT NULL,
    data text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.product_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: production_material_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_material_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    production_order_id uuid NOT NULL,
    material_id uuid NOT NULL,
    qty numeric(14,2) DEFAULT 0 NOT NULL,
    unit character varying(30),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: production_order_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_order_materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    production_order_id uuid NOT NULL,
    material_id uuid NOT NULL,
    qty numeric DEFAULT 0 NOT NULL,
    unit character varying,
    note text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: production_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_code character varying(30) NOT NULL,
    sales_order_id uuid,
    customer_id uuid,
    product_id uuid NOT NULL,
    quantity numeric(14,2) NOT NULL,
    unit character varying(30),
    attr_size character varying(100),
    attr_thickness character varying(100),
    attr_color character varying(100),
    finishing jsonb DEFAULT '[]'::jsonb NOT NULL,
    machine_id uuid,
    planned_date date,
    shift character varying(20),
    assigned_team character varying(100),
    group_key character varying(200),
    due_date date,
    status character varying(20) DEFAULT 'Chờ duyệt'::character varying NOT NULL,
    note text,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sales_order_item_id uuid,
    inventory_posted boolean DEFAULT false NOT NULL,
    assigned_worker character varying(100),
    specs jsonb DEFAULT '{}'::jsonb NOT NULL,
    spec_key text DEFAULT ''::text NOT NULL,
    posted_qty numeric(14,2) DEFAULT 0 NOT NULL,
    priority character varying(30) DEFAULT 'Trung bình'::character varying NOT NULL,
    material_type character varying(30),
    mix_ratio jsonb DEFAULT '[]'::jsonb NOT NULL,
    materials_issued boolean DEFAULT false,
    materials_issued_at timestamp with time zone,
    CONSTRAINT production_orders_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT production_orders_shift_check CHECK ((((shift)::text = ANY ((ARRAY['Ca 1'::character varying, 'Ca 2'::character varying, 'Ca 3'::character varying])::text[])) OR (shift IS NULL))),
    CONSTRAINT production_orders_status_check CHECK (((status)::text = ANY (ARRAY['Chờ duyệt'::text, 'Đã lên kế hoạch'::text, 'Chờ nguyên vật liệu'::text, 'Đang sản xuất'::text, 'Hoàn thành'::text, 'Đã hủy'::text])))
);


--
-- Name: production_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    production_order_id uuid NOT NULL,
    task_code character varying(40) NOT NULL,
    stage character varying(20) NOT NULL,
    quantity numeric(14,2) DEFAULT 0 NOT NULL,
    machine_id uuid,
    shift character varying(20),
    planned_date date,
    assigned_team character varying(100),
    assigned_worker character varying(100),
    status character varying(20) DEFAULT 'Chờ'::character varying NOT NULL,
    seq integer DEFAULT 1 NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    planned_end_date date,
    actual_qty numeric(14,2),
    scrap_qty numeric(14,2) DEFAULT 0 NOT NULL,
    posted_qty numeric(14,2) DEFAULT 0 NOT NULL,
    CONSTRAINT production_tasks_stage_check CHECK (((stage)::text = ANY ((ARRAY['Thổi'::character varying, 'Cắt'::character varying])::text[]))),
    CONSTRAINT production_tasks_status_check CHECK (((status)::text = ANY ((ARRAY['Chờ'::character varying, 'Đang sản xuất'::character varying, 'Dừng sản xuất'::character varying, 'Hoàn thành'::character varying, 'Đã hủy'::character varying])::text[])))
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_code character varying(30) NOT NULL,
    product_name character varying(255) NOT NULL,
    production_area character varying(100),
    category character varying(100),
    product_type character varying(30) NOT NULL,
    product_group character varying(100),
    unit character varying(30),
    barcode_type character varying(30),
    tracking_type character varying(20),
    is_pqc_required boolean DEFAULT false NOT NULL,
    status character varying(20) DEFAULT 'Hoạt động'::character varying NOT NULL,
    description text,
    attributes jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    product_types jsonb DEFAULT '[]'::jsonb NOT NULL,
    min_quantity numeric,
    warehouse_limits jsonb DEFAULT '[]'::jsonb,
    CONSTRAINT products_status_check CHECK (((status)::text = ANY ((ARRAY['Hoạt động'::character varying, 'Không hoạt động'::character varying])::text[]))),
    CONSTRAINT products_tracking_type_check CHECK (((tracking_type)::text = ANY ((ARRAY['Theo lô'::character varying, 'Theo serial'::character varying])::text[])))
);


--
-- Name: role_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.role_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_code character varying(20) NOT NULL,
    name character varying(150) NOT NULL,
    description text,
    permissions jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(20) DEFAULT 'Hoạt động'::character varying NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_admin boolean DEFAULT false NOT NULL,
    parent_id uuid,
    CONSTRAINT roles_status_check CHECK (((status)::text = ANY ((ARRAY['Hoạt động'::character varying, 'Không hoạt động'::character varying])::text[])))
);


--
-- Name: sales_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sales_order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    quantity numeric(14,2) NOT NULL,
    unit character varying(30),
    attr_size character varying(100),
    attr_thickness character varying(100),
    attr_color character varying(100),
    note text,
    is_planned boolean DEFAULT false NOT NULL,
    planned_qty numeric(14,2) DEFAULT 0 NOT NULL,
    specs jsonb DEFAULT '{}'::jsonb NOT NULL,
    spec_key text DEFAULT ''::text NOT NULL,
    core_weight numeric(14,2),
    total_weight numeric(14,2),
    planned_start_date date,
    planned_end_date date,
    actual_start_date timestamp with time zone,
    actual_end_date timestamp with time zone,
    mix_ratio jsonb DEFAULT '[]'::jsonb NOT NULL,
    material_type character varying(30),
    unit_price numeric DEFAULT 0,
    CONSTRAINT sales_order_items_quantity_check CHECK ((quantity > (0)::numeric))
);


--
-- Name: sales_order_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sales_order_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sales_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_code character varying(30) NOT NULL,
    customer_id uuid NOT NULL,
    order_date date DEFAULT CURRENT_DATE NOT NULL,
    due_date date,
    status character varying(50) DEFAULT 'Mới'::character varying NOT NULL,
    note text,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    priority character varying(30) DEFAULT 'Trung bình'::character varying NOT NULL,
    material_type character varying(30),
    mix_ratio jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT sales_orders_status_check CHECK (((status)::text = ANY ((ARRAY['Mới'::character varying, 'Đang sản xuất'::character varying, 'Hoàn thành sản xuất'::character varying, 'Chuyển hàng 1 phần'::character varying, 'Đang vận chuyển'::character varying, 'Đã vận chuyển, chưa thanh toán'::character varying, 'Đã thanh toán'::character varying, 'Hoàn thành'::character varying, 'Đã hủy'::character varying])::text[])))
);


--
-- Name: shift_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shift_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shift_code character varying(20) NOT NULL,
    name character varying(50) NOT NULL,
    start_time time without time zone,
    end_time time without time zone,
    status character varying(20) DEFAULT 'Hoạt động'::character varying NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shifts_status_check CHECK (((status)::text = ANY ((ARRAY['Hoạt động'::character varying, 'Không hoạt động'::character varying])::text[])))
);


--
-- Name: tech_processes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tech_processes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    process_code character varying(20) NOT NULL,
    name character varying(200) NOT NULL,
    product_id uuid,
    status character varying(20) DEFAULT 'Hoạt động'::character varying NOT NULL,
    note text,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tech_processes_status_check CHECK (((status)::text = ANY ((ARRAY['Hoạt động'::character varying, 'Không hoạt động'::character varying])::text[])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username character varying(50) NOT NULL,
    password_hash character varying(255) NOT NULL,
    full_name character varying(150),
    role_id uuid,
    status character varying(20) DEFAULT 'Hoạt động'::character varying NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    team character varying(100),
    permissions jsonb DEFAULT '{}'::jsonb NOT NULL,
    linked_worker character varying(100),
    CONSTRAINT users_status_check CHECK (((status)::text = ANY ((ARRAY['Hoạt động'::character varying, 'Không hoạt động'::character varying])::text[])))
);


--
-- Name: warehouse_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.warehouse_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: warehouses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warehouses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    warehouse_code character varying(30) NOT NULL,
    name character varying(150) NOT NULL,
    warehouse_type character varying(20) DEFAULT 'NVL'::character varying NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(30) DEFAULT 'Hoạt động'::character varying NOT NULL,
    purpose character varying(150),
    factory character varying(100),
    workshop character varying(100),
    address character varying(255),
    manager character varying(100),
    department character varying(100),
    phone character varying(50),
    description text,
    allow_inbound boolean DEFAULT true,
    allow_outbound boolean DEFAULT true,
    allow_transfer boolean DEFAULT true,
    allow_manufacturing boolean DEFAULT true,
    require_qc boolean DEFAULT false,
    require_approval boolean DEFAULT false,
    outbound_method character varying(50) DEFAULT 'FIFO'::character varying,
    capacity_unit character varying(20),
    max_capacity numeric,
    capacity_warning numeric,
    CONSTRAINT warehouses_warehouse_type_check CHECK (((warehouse_type)::text = ANY ((ARRAY['NVL'::character varying, 'BTP'::character varying, 'TP'::character varying])::text[])))
);


--
-- Name: work_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    work_date date NOT NULL,
    shift_id uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    check_in_at timestamp with time zone,
    check_out_at timestamp with time zone
);


--
-- Name: zone_code_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.zone_code_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    warehouse_id uuid,
    zone_code character varying(30) DEFAULT ('KV'::text || lpad((nextval('public.zone_code_seq'::regclass))::text, 3, '0'::text)) NOT NULL,
    name character varying(150) NOT NULL,
    description text,
    status character varying(30) DEFAULT 'Hoạt động'::character varying NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bom_lines bom_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bom_lines
    ADD CONSTRAINT bom_lines_pkey PRIMARY KEY (id);


--
-- Name: boms boms_bom_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boms
    ADD CONSTRAINT boms_bom_code_key UNIQUE (bom_code);


--
-- Name: boms boms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boms
    ADD CONSTRAINT boms_pkey PRIMARY KEY (id);


--
-- Name: customers customers_customer_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_customer_code_key UNIQUE (customer_code);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: delivery_note_items delivery_note_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_note_items
    ADD CONSTRAINT delivery_note_items_pkey PRIMARY KEY (id);


--
-- Name: delivery_notes delivery_notes_note_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_notes
    ADD CONSTRAINT delivery_notes_note_code_key UNIQUE (note_code);


--
-- Name: delivery_notes delivery_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_notes
    ADD CONSTRAINT delivery_notes_pkey PRIMARY KEY (id);


--
-- Name: employees employees_employee_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_employee_code_key UNIQUE (employee_code);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: inventory_stock inventory_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_stock
    ADD CONSTRAINT inventory_stock_pkey PRIMARY KEY (id);


--
-- Name: inventory_transactions inventory_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_pkey PRIMARY KEY (id);


--
-- Name: locations locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);


--
-- Name: locations locations_warehouse_id_location_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_warehouse_id_location_code_key UNIQUE (warehouse_id, location_code);


--
-- Name: machines machines_machine_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machines
    ADD CONSTRAINT machines_machine_code_key UNIQUE (machine_code);


--
-- Name: machines machines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machines
    ADD CONSTRAINT machines_pkey PRIMARY KEY (id);


--
-- Name: outbound_slip_lines outbound_slip_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_slip_lines
    ADD CONSTRAINT outbound_slip_lines_pkey PRIMARY KEY (id);


--
-- Name: outbound_slips outbound_slips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_slips
    ADD CONSTRAINT outbound_slips_pkey PRIMARY KEY (id);


--
-- Name: outbound_slips outbound_slips_slip_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_slips
    ADD CONSTRAINT outbound_slips_slip_code_key UNIQUE (slip_code);


--
-- Name: process_steps process_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_steps
    ADD CONSTRAINT process_steps_pkey PRIMARY KEY (id);


--
-- Name: product_attachments product_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attachments
    ADD CONSTRAINT product_attachments_pkey PRIMARY KEY (id);


--
-- Name: production_material_usage production_material_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_material_usage
    ADD CONSTRAINT production_material_usage_pkey PRIMARY KEY (id);


--
-- Name: production_material_usage production_material_usage_production_order_id_material_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_material_usage
    ADD CONSTRAINT production_material_usage_production_order_id_material_id_key UNIQUE (production_order_id, material_id);


--
-- Name: production_order_materials production_order_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_order_materials
    ADD CONSTRAINT production_order_materials_pkey PRIMARY KEY (id);


--
-- Name: production_orders production_orders_order_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_orders
    ADD CONSTRAINT production_orders_order_code_key UNIQUE (order_code);


--
-- Name: production_orders production_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_orders
    ADD CONSTRAINT production_orders_pkey PRIMARY KEY (id);


--
-- Name: production_tasks production_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_tasks
    ADD CONSTRAINT production_tasks_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_product_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_product_code_key UNIQUE (product_code);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: roles roles_role_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_role_code_key UNIQUE (role_code);


--
-- Name: sales_order_items sales_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_items
    ADD CONSTRAINT sales_order_items_pkey PRIMARY KEY (id);


--
-- Name: sales_orders sales_orders_order_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_order_code_key UNIQUE (order_code);


--
-- Name: sales_orders sales_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_pkey PRIMARY KEY (id);


--
-- Name: shifts shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_pkey PRIMARY KEY (id);


--
-- Name: shifts shifts_shift_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_shift_code_key UNIQUE (shift_code);


--
-- Name: tech_processes tech_processes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tech_processes
    ADD CONSTRAINT tech_processes_pkey PRIMARY KEY (id);


--
-- Name: tech_processes tech_processes_process_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tech_processes
    ADD CONSTRAINT tech_processes_process_code_key UNIQUE (process_code);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: warehouses warehouses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_pkey PRIMARY KEY (id);


--
-- Name: warehouses warehouses_warehouse_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_warehouse_code_key UNIQUE (warehouse_code);


--
-- Name: work_schedules work_schedules_employee_id_work_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_schedules
    ADD CONSTRAINT work_schedules_employee_id_work_date_key UNIQUE (employee_id, work_date);


--
-- Name: work_schedules work_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_schedules
    ADD CONSTRAINT work_schedules_pkey PRIMARY KEY (id);


--
-- Name: zones zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_pkey PRIMARY KEY (id);


--
-- Name: zones zones_zone_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_zone_code_key UNIQUE (zone_code);


--
-- Name: idx_bl_bom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bl_bom ON public.bom_lines USING btree (bom_id);


--
-- Name: idx_bl_mat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bl_mat ON public.bom_lines USING btree (material_id);


--
-- Name: idx_bomlines_bom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bomlines_bom ON public.bom_lines USING btree (bom_id);


--
-- Name: idx_boms_process; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_boms_process ON public.boms USING btree (process_id);


--
-- Name: idx_boms_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_boms_product ON public.boms USING btree (product_id);


--
-- Name: idx_dn_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dn_customer ON public.delivery_notes USING btree (customer_id);


--
-- Name: idx_dn_so; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dn_so ON public.delivery_notes USING btree (sales_order_id);


--
-- Name: idx_dni_dn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dni_dn ON public.delivery_note_items USING btree (delivery_note_id);


--
-- Name: idx_dni_note; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dni_note ON public.delivery_note_items USING btree (delivery_note_id);


--
-- Name: idx_dni_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dni_product ON public.delivery_note_items USING btree (product_id);


--
-- Name: idx_ist_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ist_location ON public.inventory_stock USING btree (location_id);


--
-- Name: idx_ist_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ist_po ON public.inventory_stock USING btree (prod_order_id);


--
-- Name: idx_ist_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ist_product ON public.inventory_stock USING btree (product_id);


--
-- Name: idx_itx_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_itx_location ON public.inventory_transactions USING btree (location_id);


--
-- Name: idx_itx_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_itx_product ON public.inventory_transactions USING btree (product_id);


--
-- Name: idx_itx_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_itx_ref ON public.inventory_transactions USING btree (ref_code);


--
-- Name: idx_obs_loc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obs_loc ON public.outbound_slips USING btree (location_id);


--
-- Name: idx_obs_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obs_po ON public.outbound_slips USING btree (prod_order_id);


--
-- Name: idx_obs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obs_status ON public.outbound_slips USING btree (status);


--
-- Name: idx_obsl_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obsl_product ON public.outbound_slip_lines USING btree (product_id);


--
-- Name: idx_obsl_slip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_obsl_slip ON public.outbound_slip_lines USING btree (slip_id);


--
-- Name: idx_pa_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pa_product ON public.product_attachments USING btree (product_id, created_at DESC);


--
-- Name: idx_pmu_mat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pmu_mat ON public.production_material_usage USING btree (material_id);


--
-- Name: idx_pmu_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pmu_po ON public.production_material_usage USING btree (production_order_id);


--
-- Name: idx_po_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_customer ON public.production_orders USING btree (customer_id);


--
-- Name: idx_po_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_group ON public.production_orders USING btree (group_key);


--
-- Name: idx_po_machine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_machine ON public.production_orders USING btree (machine_id);


--
-- Name: idx_po_notdel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_notdel ON public.production_orders USING btree (is_deleted) WHERE (is_deleted = false);


--
-- Name: idx_po_planned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_planned ON public.production_orders USING btree (planned_date);


--
-- Name: idx_po_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_product ON public.production_orders USING btree (product_id);


--
-- Name: idx_po_so; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_so ON public.production_orders USING btree (sales_order_id);


--
-- Name: idx_po_soi; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_soi ON public.production_orders USING btree (sales_order_item_id);


--
-- Name: idx_po_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_status ON public.production_orders USING btree (status);


--
-- Name: idx_pom_mat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pom_mat ON public.production_order_materials USING btree (material_id);


--
-- Name: idx_pom_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pom_po ON public.production_order_materials USING btree (production_order_id);


--
-- Name: idx_products_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_area ON public.products USING btree (production_area);


--
-- Name: idx_products_attributes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_attributes ON public.products USING gin (attributes);


--
-- Name: idx_products_code_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_code_trgm ON public.products USING btree (lower((product_code)::text));


--
-- Name: idx_products_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_name_trgm ON public.products USING btree (lower((product_name)::text));


--
-- Name: idx_products_not_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_not_deleted ON public.products USING btree (is_deleted) WHERE (is_deleted = false);


--
-- Name: idx_products_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_type ON public.products USING btree (product_type);


--
-- Name: idx_psteps_proc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_psteps_proc ON public.process_steps USING btree (process_id);


--
-- Name: idx_pt_machine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pt_machine ON public.production_tasks USING btree (machine_id);


--
-- Name: idx_pt_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pt_po ON public.production_tasks USING btree (production_order_id);


--
-- Name: idx_soi_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_soi_order ON public.sales_order_items USING btree (sales_order_id);


--
-- Name: idx_soi_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_soi_product ON public.sales_order_items USING btree (product_id);


--
-- Name: idx_stock_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_product ON public.inventory_stock USING btree (product_id);


--
-- Name: idx_stock_speckey; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_speckey ON public.inventory_stock USING btree (product_id, spec_key);


--
-- Name: idx_tasks_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_po ON public.production_tasks USING btree (production_order_id);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role_id);


--
-- Name: idx_ws_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ws_date ON public.work_schedules USING btree (work_date);


--
-- Name: idx_ws_emp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ws_emp ON public.work_schedules USING btree (employee_id);


--
-- Name: idx_ws_shift; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ws_shift ON public.work_schedules USING btree (shift_id);


--
-- Name: idx_zones_warehouse; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_zones_warehouse ON public.zones USING btree (warehouse_id);


--
-- Name: uq_stock_spec_lot; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_stock_spec_lot ON public.inventory_stock USING btree (product_id, location_id, spec_key, lot_code) NULLS NOT DISTINCT;


--
-- Name: boms trg_boms_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_boms_updated BEFORE UPDATE ON public.boms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: customers trg_customers_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: employees trg_employees_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: boms trg_gen_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gen_code BEFORE INSERT ON public.boms FOR EACH ROW EXECUTE FUNCTION public.gen_code_trg('BOM', '5', 'bom_code');


--
-- Name: customers trg_gen_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gen_code BEFORE INSERT ON public.customers FOR EACH ROW EXECUTE FUNCTION public.gen_code_trg('KH', '5', 'customer_code');


--
-- Name: delivery_notes trg_gen_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gen_code BEFORE INSERT ON public.delivery_notes FOR EACH ROW EXECUTE FUNCTION public.gen_code_trg('PG', '5', 'note_code');


--
-- Name: employees trg_gen_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gen_code BEFORE INSERT ON public.employees FOR EACH ROW EXECUTE FUNCTION public.gen_code_trg('NV', '5', 'employee_code');


--
-- Name: locations trg_gen_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gen_code BEFORE INSERT ON public.locations FOR EACH ROW EXECUTE FUNCTION public.gen_code_trg('VT', '4', 'location_code');


--
-- Name: machines trg_gen_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gen_code BEFORE INSERT ON public.machines FOR EACH ROW EXECUTE FUNCTION public.gen_code_trg('MC', '4', 'machine_code');


--
-- Name: production_orders trg_gen_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gen_code BEFORE INSERT ON public.production_orders FOR EACH ROW EXECUTE FUNCTION public.gen_code_trg('LSX', '5', 'order_code');


--
-- Name: products trg_gen_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gen_code BEFORE INSERT ON public.products FOR EACH ROW EXECUTE FUNCTION public.gen_code_trg('SP', '5', 'product_code');


--
-- Name: roles trg_gen_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gen_code BEFORE INSERT ON public.roles FOR EACH ROW EXECUTE FUNCTION public.gen_code_trg('VT', '3', 'role_code');


--
-- Name: sales_orders trg_gen_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gen_code BEFORE INSERT ON public.sales_orders FOR EACH ROW EXECUTE FUNCTION public.gen_code_trg('DH', '5', 'order_code');


--
-- Name: shifts trg_gen_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gen_code BEFORE INSERT ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.gen_code_trg('CA', '2', 'shift_code');


--
-- Name: tech_processes trg_gen_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gen_code BEFORE INSERT ON public.tech_processes FOR EACH ROW EXECUTE FUNCTION public.gen_code_trg('QT', '4', 'process_code');


--
-- Name: warehouses trg_gen_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gen_code BEFORE INSERT ON public.warehouses FOR EACH ROW EXECUTE FUNCTION public.gen_code_trg('K', '3', 'warehouse_code');


--
-- Name: locations trg_locations_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_locations_updated BEFORE UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: machines trg_machines_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_machines_updated BEFORE UPDATE ON public.machines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: production_orders trg_production_orders_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_production_orders_updated BEFORE UPDATE ON public.production_orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: products trg_products_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: roles trg_roles_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_roles_updated BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: sales_orders trg_sales_orders_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sales_orders_updated BEFORE UPDATE ON public.sales_orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: shifts trg_shifts_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_shifts_updated BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: production_tasks trg_tasks_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON public.production_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tech_processes trg_tech_processes_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tech_processes_updated BEFORE UPDATE ON public.tech_processes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_users_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: warehouses trg_warehouses_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_warehouses_updated BEFORE UPDATE ON public.warehouses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: work_schedules trg_work_schedules_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_work_schedules_updated BEFORE UPDATE ON public.work_schedules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: zones trg_zones_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_zones_updated BEFORE UPDATE ON public.zones FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: bom_lines bom_lines_bom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bom_lines
    ADD CONSTRAINT bom_lines_bom_id_fkey FOREIGN KEY (bom_id) REFERENCES public.boms(id) ON DELETE CASCADE;


--
-- Name: bom_lines bom_lines_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bom_lines
    ADD CONSTRAINT bom_lines_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.products(id);


--
-- Name: boms boms_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boms
    ADD CONSTRAINT boms_process_id_fkey FOREIGN KEY (process_id) REFERENCES public.tech_processes(id);


--
-- Name: boms boms_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boms
    ADD CONSTRAINT boms_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: delivery_note_items delivery_note_items_delivery_note_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_note_items
    ADD CONSTRAINT delivery_note_items_delivery_note_id_fkey FOREIGN KEY (delivery_note_id) REFERENCES public.delivery_notes(id) ON DELETE CASCADE;


--
-- Name: delivery_note_items delivery_note_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_note_items
    ADD CONSTRAINT delivery_note_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: delivery_notes delivery_notes_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_notes
    ADD CONSTRAINT delivery_notes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: delivery_notes delivery_notes_sales_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_notes
    ADD CONSTRAINT delivery_notes_sales_order_id_fkey FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders(id);


--
-- Name: inventory_stock inventory_stock_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_stock
    ADD CONSTRAINT inventory_stock_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: inventory_stock inventory_stock_prod_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_stock
    ADD CONSTRAINT inventory_stock_prod_order_id_fkey FOREIGN KEY (prod_order_id) REFERENCES public.production_orders(id);


--
-- Name: inventory_stock inventory_stock_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_stock
    ADD CONSTRAINT inventory_stock_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: inventory_transactions inventory_transactions_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: inventory_transactions inventory_transactions_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: locations locations_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE;


--
-- Name: locations locations_zone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.zones(id);


--
-- Name: outbound_slip_lines outbound_slip_lines_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_slip_lines
    ADD CONSTRAINT outbound_slip_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: outbound_slip_lines outbound_slip_lines_slip_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_slip_lines
    ADD CONSTRAINT outbound_slip_lines_slip_id_fkey FOREIGN KEY (slip_id) REFERENCES public.outbound_slips(id) ON DELETE CASCADE;


--
-- Name: outbound_slips outbound_slips_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_slips
    ADD CONSTRAINT outbound_slips_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: outbound_slips outbound_slips_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_slips
    ADD CONSTRAINT outbound_slips_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: outbound_slips outbound_slips_prod_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outbound_slips
    ADD CONSTRAINT outbound_slips_prod_order_id_fkey FOREIGN KEY (prod_order_id) REFERENCES public.production_orders(id) ON DELETE SET NULL;


--
-- Name: process_steps process_steps_input_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_steps
    ADD CONSTRAINT process_steps_input_product_id_fkey FOREIGN KEY (input_product_id) REFERENCES public.products(id);


--
-- Name: process_steps process_steps_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_steps
    ADD CONSTRAINT process_steps_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id);


--
-- Name: process_steps process_steps_output_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_steps
    ADD CONSTRAINT process_steps_output_product_id_fkey FOREIGN KEY (output_product_id) REFERENCES public.products(id);


--
-- Name: process_steps process_steps_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.process_steps
    ADD CONSTRAINT process_steps_process_id_fkey FOREIGN KEY (process_id) REFERENCES public.tech_processes(id) ON DELETE CASCADE;


--
-- Name: product_attachments product_attachments_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_attachments
    ADD CONSTRAINT product_attachments_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: production_material_usage production_material_usage_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_material_usage
    ADD CONSTRAINT production_material_usage_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.products(id);


--
-- Name: production_material_usage production_material_usage_production_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_material_usage
    ADD CONSTRAINT production_material_usage_production_order_id_fkey FOREIGN KEY (production_order_id) REFERENCES public.production_orders(id) ON DELETE CASCADE;


--
-- Name: production_order_materials production_order_materials_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_order_materials
    ADD CONSTRAINT production_order_materials_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.products(id);


--
-- Name: production_order_materials production_order_materials_production_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_order_materials
    ADD CONSTRAINT production_order_materials_production_order_id_fkey FOREIGN KEY (production_order_id) REFERENCES public.production_orders(id) ON DELETE CASCADE;


--
-- Name: production_orders production_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_orders
    ADD CONSTRAINT production_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: production_orders production_orders_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_orders
    ADD CONSTRAINT production_orders_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id);


--
-- Name: production_orders production_orders_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_orders
    ADD CONSTRAINT production_orders_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: production_orders production_orders_sales_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_orders
    ADD CONSTRAINT production_orders_sales_order_id_fkey FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders(id);


--
-- Name: production_orders production_orders_sales_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_orders
    ADD CONSTRAINT production_orders_sales_order_item_id_fkey FOREIGN KEY (sales_order_item_id) REFERENCES public.sales_order_items(id) ON DELETE SET NULL;


--
-- Name: production_tasks production_tasks_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_tasks
    ADD CONSTRAINT production_tasks_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id);


--
-- Name: production_tasks production_tasks_production_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_tasks
    ADD CONSTRAINT production_tasks_production_order_id_fkey FOREIGN KEY (production_order_id) REFERENCES public.production_orders(id) ON DELETE CASCADE;


--
-- Name: roles roles_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.roles(id) ON DELETE SET NULL;


--
-- Name: sales_order_items sales_order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_items
    ADD CONSTRAINT sales_order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: sales_order_items sales_order_items_sales_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_order_items
    ADD CONSTRAINT sales_order_items_sales_order_id_fkey FOREIGN KEY (sales_order_id) REFERENCES public.sales_orders(id) ON DELETE CASCADE;


--
-- Name: sales_orders sales_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_orders
    ADD CONSTRAINT sales_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: tech_processes tech_processes_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tech_processes
    ADD CONSTRAINT tech_processes_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: users users_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: work_schedules work_schedules_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_schedules
    ADD CONSTRAINT work_schedules_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: work_schedules work_schedules_shift_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_schedules
    ADD CONSTRAINT work_schedules_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES public.shifts(id);


--
-- Name: zones zones_warehouse_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zones
    ADD CONSTRAINT zones_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id);


--
-- PostgreSQL database dump complete
--


--
-- =====================================================================
-- POST-MIGRATION (idempotent) — các đối tượng thêm sau khi phát triển,
-- chạy lại nhiều lần vô hại. Giữ ở CUỐI file để mọi bảng tham chiếu đã tồn tại.
-- =====================================================================
--

-- 1) Khớp nhân sự theo mã ID (KPI + phân công) — B4
ALTER TABLE public.production_orders ADD COLUMN IF NOT EXISTS assigned_worker_id uuid;
ALTER TABLE public.production_tasks  ADD COLUMN IF NOT EXISTS assigned_worker_id uuid;

-- 2) Ghi phế theo ngày (module Phế phẩm)
CREATE TABLE IF NOT EXISTS public.daily_scrap_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name character varying NOT NULL,
  record_date date NOT NULL,
  note text,
  employee_id uuid REFERENCES public.employees(id),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT daily_scrap_records_worker_date_key UNIQUE (worker_name, record_date)
);
CREATE TABLE IF NOT EXISTS public.daily_scrap_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES public.daily_scrap_records(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  finished_qty numeric NOT NULL DEFAULT 0,
  scrap_qty numeric NOT NULL DEFAULT 0,
  CONSTRAINT daily_scrap_items_record_product_key UNIQUE (record_id, product_id)
);

-- 3) Kho Phế Phẩm: mở rộng CHECK warehouse_type + seed kho + 1 location
ALTER TABLE public.warehouses DROP CONSTRAINT IF EXISTS warehouses_warehouse_type_check;
ALTER TABLE public.warehouses ADD CONSTRAINT warehouses_warehouse_type_check
  CHECK ((warehouse_type)::text = ANY (ARRAY['NVL','BTP','TP','Phế liệu']::text[]));
INSERT INTO public.warehouses (name, warehouse_type)
  SELECT 'Kho Phế Phẩm', 'Phế liệu'
  WHERE NOT EXISTS (SELECT 1 FROM public.warehouses WHERE warehouse_type = 'Phế liệu');
INSERT INTO public.locations (warehouse_id, location_code, name)
  SELECT w.id, 'PHE-01', 'Khu phế phẩm'
  FROM public.warehouses w
  WHERE w.warehouse_type = 'Phế liệu'
    AND NOT EXISTS (SELECT 1 FROM public.locations l WHERE l.warehouse_id = w.id);

-- 4) Đơn giá dòng hàng đơn bán (tính tổng tiền đơn hàng)
ALTER TABLE public.sales_order_items ADD COLUMN IF NOT EXISTS unit_price numeric DEFAULT 0;

-- 5) Phiếu giao hàng: SL thực tế giao + liên kết dòng đơn (để tính SL đã giao/còn lại, cập nhật trạng thái đơn)
ALTER TABLE public.delivery_note_items ADD COLUMN IF NOT EXISTS actual_quantity numeric;
ALTER TABLE public.delivery_note_items ADD COLUMN IF NOT EXISTS sales_order_item_id uuid REFERENCES public.sales_order_items(id);

-- 6) Phiếu giao hàng: thêm trạng thái "Bản nháp" (mặc định khi tạo) + "Giao hàng"
--    (nút Giao hàng tạo phiếu xuất kho "Giao hàng cho khách" + trừ tồn Kho Thành phẩm)
ALTER TABLE public.delivery_notes DROP CONSTRAINT IF EXISTS delivery_notes_status_check;
ALTER TABLE public.delivery_notes ADD CONSTRAINT delivery_notes_status_check
  CHECK ((status)::text = ANY (ARRAY['Bản nháp','Giao hàng','Đã xuất hóa đơn','Chờ thanh toán','Đã thanh toán 1 phần','Đã thanh toán','Đã hủy']::text[]));

-- 7) Module Tái chế (phế phẩm → cuộn PE): phiếu tái chế + các cuộn PE thu về.
--    Trước đây 2 bảng này tạo tay ngoài schema → DB dựng mới bị thiếu, module lỗi ngay.
CREATE TABLE IF NOT EXISTS public.recycling_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_code varchar(100) NOT NULL UNIQUE,
  status varchar(50) DEFAULT 'Chờ cân',
  export_date date,
  scrap_warehouse_id uuid,
  expected_qty numeric(15,3) DEFAULT 0,
  third_party_name varchar(255),
  internal_scrap_qty numeric(15,3) DEFAULT 0,
  mixed_scrap_qty numeric(15,3) DEFAULT 0,
  weighing_person varchar(100),
  weighing_time timestamp,
  total_received_qty numeric(15,3) DEFAULT 0,
  loss_qty numeric(15,3) DEFAULT 0,
  import_warehouse_id uuid,
  product_id uuid,
  note text,
  created_by varchar(100),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  completed_at timestamp
);
CREATE TABLE IF NOT EXISTS public.recycling_rolls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES public.recycling_tickets(id) ON DELETE CASCADE,
  roll_code varchar(100) NOT NULL,
  pe_type varchar(100),
  weight numeric(15,3) DEFAULT 0,
  unit varchar(20) DEFAULT 'kg',
  note text,
  created_at timestamp DEFAULT now()
);


-- 8) Hiệu năng & toàn vẹn: index cho các cột FK hay join/lọc (giảm seq-scan trong
--    các subquery theo dòng), + cột ad-hoc của module Ghi phế (trước đây ALTER lúc chạy).
ALTER TABLE public.daily_scrap_records ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.employees(id);
ALTER TABLE public.daily_scrap_records ADD COLUMN IF NOT EXISTS recorder_name character varying;

CREATE INDEX IF NOT EXISTS idx_dni_delivery_note        ON public.delivery_note_items (delivery_note_id);
CREATE INDEX IF NOT EXISTS idx_dni_sales_order_item     ON public.delivery_note_items (sales_order_item_id);
CREATE INDEX IF NOT EXISTS idx_dn_customer              ON public.delivery_notes (customer_id);
CREATE INDEX IF NOT EXISTS idx_dn_sales_order           ON public.delivery_notes (sales_order_id);
CREATE INDEX IF NOT EXISTS idx_soi_sales_order          ON public.sales_order_items (sales_order_id);
CREATE INDEX IF NOT EXISTS idx_soi_product              ON public.sales_order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_po_sales_order           ON public.production_orders (sales_order_id);
CREATE INDEX IF NOT EXISTS idx_po_sales_order_item      ON public.production_orders (sales_order_item_id);
CREATE INDEX IF NOT EXISTS idx_po_product               ON public.production_orders (product_id);
CREATE INDEX IF NOT EXISTS idx_pt_production_order      ON public.production_tasks (production_order_id);
CREATE INDEX IF NOT EXISTS idx_pt_assigned_worker_id    ON public.production_tasks (assigned_worker_id);
CREATE INDEX IF NOT EXISTS idx_pom_production_order     ON public.production_order_materials (production_order_id);
CREATE INDEX IF NOT EXISTS idx_pom_material             ON public.production_order_materials (material_id);
CREATE INDEX IF NOT EXISTS idx_stock_product            ON public.inventory_stock (product_id);
CREATE INDEX IF NOT EXISTS idx_stock_location           ON public.inventory_stock (location_id);
CREATE INDEX IF NOT EXISTS idx_trx_product              ON public.inventory_transactions (product_id);
CREATE INDEX IF NOT EXISTS idx_trx_ref_code             ON public.inventory_transactions (ref_code);
CREATE INDEX IF NOT EXISTS idx_osl_slip                 ON public.outbound_slip_lines (slip_id);
CREATE INDEX IF NOT EXISTS idx_os_prod_order            ON public.outbound_slips (prod_order_id);
CREATE INDEX IF NOT EXISTS idx_recroll_ticket           ON public.recycling_rolls (ticket_id);
CREATE INDEX IF NOT EXISTS idx_dsi_record               ON public.daily_scrap_items (record_id);
CREATE INDEX IF NOT EXISTS idx_locations_warehouse      ON public.locations (warehouse_id);


-- 9) M50: xuất/chuyển kho theo FIFO cần biết lô vào vị trí kho LÚC NÀO (id là UUID ngẫu nhiên,
--    không phản ánh thứ tự nhập). Dòng tồn cũ: lấy lần "Nhập" sớm nhất trong sổ giao dịch, không có thì updated_at.
ALTER TABLE public.inventory_stock ADD COLUMN IF NOT EXISTS created_at timestamp with time zone;
UPDATE public.inventory_stock st
   SET created_at = COALESCE((
         SELECT MIN(t.created_at) FROM public.inventory_transactions t
          WHERE t.product_id = st.product_id AND t.location_id IS NOT DISTINCT FROM st.location_id
            AND t.spec_key = st.spec_key AND t.lot_code = st.lot_code AND t.trx_type = 'Nhập'),
         st.updated_at)
 WHERE st.created_at IS NULL;
ALTER TABLE public.inventory_stock ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.inventory_stock ALTER COLUMN created_at SET NOT NULL;

-- 10) Thiết kế cuộn BTP (Thổi → Cuộn SP-PE-TC → Cắt → Bao bì). Xem docs/ai/plans/2026-10-08-thiet-ke-cuon-btp.md
--     a) Cài đặt hệ thống dạng key/value
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--     b) Sản phẩm cuộn MẶC ĐỊNH (điền sẵn ô "Sản phẩm đầu ra" dòng Thổi).
--        Ưu tiên SP00017 (cuộn bao bì ở PRD), fallback SP-PE-TC. Chỉ seed nếu chưa có.
INSERT INTO public.app_settings (key, value)
SELECT 'roll_product_id', to_jsonb(id::text) FROM public.products
WHERE product_code IN ('SP00017', 'SP-PE-TC') AND is_deleted = FALSE
ORDER BY (product_code = 'SP00017') DESC
LIMIT 1
ON CONFLICT (key) DO NOTHING;
--        Sửa giá trị cũ (đã lỡ set = SP-PE-TC) sang SP00017 nếu có — KHÔNG đụng nếu người dùng đã chọn mã khác.
UPDATE public.app_settings a
SET value = to_jsonb(p.id::text), updated_at = now()
FROM public.products p
WHERE a.key = 'roll_product_id' AND p.product_code = 'SP00017' AND p.is_deleted = FALSE
  AND a.value = (SELECT to_jsonb(id::text) FROM public.products WHERE product_code = 'SP-PE-TC' AND is_deleted = FALSE LIMIT 1);

--     b2) Sản phẩm đầu ra của từng dòng phân công (Thổi→cuộn vào BTP, Cắt→bao bì vào TP).
--         NULL = dùng mặc định (Thổi: roll_product_id; Cắt: sản phẩm của lệnh).
ALTER TABLE public.production_tasks ADD COLUMN IF NOT EXISTS output_product_id uuid REFERENCES public.products(id);

--     c) Ghi lại công đoạn Cắt đã trừ những lô cuộn nào (truy xuất + hoàn kho khi Admin hủy hoàn thành)
CREATE TABLE IF NOT EXISTS public.production_roll_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid NOT NULL REFERENCES public.production_orders(id),
  task_code varchar(40) NOT NULL,            -- khóa bền (production_tasks bị DELETE+INSERT mỗi lần lưu)
  roll_product_id uuid NOT NULL,
  location_id uuid NOT NULL,
  lot_code varchar(40) NOT NULL,             -- lô cuộn bị trừ (mã LSX đã thổi ra nó)
  spec_key text NOT NULL,
  specs jsonb NOT NULL DEFAULT '{}'::jsonb,
  qty_used numeric(14,2) NOT NULL,           -- kg trừ để cắt
  qty_written_off numeric(14,2) NOT NULL DEFAULT 0, -- kg dư xóa do "đã hết cuộn"
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_roll_usage_task ON public.production_roll_usage (production_order_id, task_code);
CREATE INDEX IF NOT EXISTS idx_roll_usage_lot  ON public.production_roll_usage (lot_code);

-- 11) NVL MẶC ĐỊNH điền sẵn dòng đầu bảng NVL (Đơn hàng: khi chọn Hàng pha; LSX: bảng NVL cần cung cấp).
--     Chỉ là gợi ý, người dùng sửa/xóa/thêm bình thường. Theo chủ dự án: hạt nhựa nguyên sinh SP00003.
--     Chỉ seed nếu chưa có — đổi mã khác thì sửa trực tiếp giá trị trong app_settings, không cần sửa code.
INSERT INTO public.app_settings (key, value)
SELECT 'default_material_product_id', to_jsonb(id::text) FROM public.products
WHERE product_code = 'SP00003' AND is_deleted = FALSE
LIMIT 1
ON CONFLICT (key) DO NOTHING;

-- 12) Sinh mã tự động: CHỈ đếm mã đúng mẫu <tiền tố><số> (vd DH00021), bỏ qua mã lạ / mã test
--     (vd 'SO-TEST-1791372234109' trước đây làm phần số vượt kiểu int → KHÔNG tạo được đơn mới).
--     Dùng bigint để không tràn. Đồng bộ với lookupController.nextCode.
CREATE OR REPLACE FUNCTION public.gen_code_trg() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  prefix  text := TG_ARGV[0];
  width   int  := TG_ARGV[1]::int;
  colname text := TG_ARGV[2];
  cur     text;
  nextn   bigint;
  rec     jsonb;
BEGIN
  rec := to_jsonb(NEW);
  cur := rec->>colname;
  IF cur IS NULL OR cur = '' THEN
    EXECUTE format(
      'SELECT COALESCE(MAX(substr(%I, length($1) + 1)::bigint), 0) + 1 FROM %I
        WHERE left(%I, length($1)) = $1 AND substr(%I, length($1) + 1) ~ ''^[0-9]{1,18}$''',
      colname, TG_TABLE_NAME, colname, colname
    ) INTO nextn USING prefix;
    rec := jsonb_set(rec, ARRAY[colname], to_jsonb(prefix || lpad(nextn::text, width, '0')));
    NEW := jsonb_populate_record(NEW, rec);
  END IF;
  RETURN NEW;
END
$$;
