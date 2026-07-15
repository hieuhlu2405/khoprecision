#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { computeSnapshotBounds } from "../lib/inventory-snapshot-bounds.mjs";

const PAGE_SIZE = 1000;
const MAX_CANDIDATES = 20;
const ALLOWED_BUSINESS_RPC = "inventory_calculate_product_stock_v1";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadLocalEnv() {
  dotenv.config({ path: resolve(REPO_ROOT, ".env.local"), quiet: true });
  dotenv.config({ path: resolve(REPO_ROOT, ".env.openclaw.local"), override: true, quiet: true });
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("vi-VN")
    .replace(/\s+/g, " ")
    .trim();
}

function addDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getTodayVNStr(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function getDaysAgo(dateStr, days) {
  return addDays(dateStr, -days);
}

function safeNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidPlanDateArg(value) {
  return ["today", "tomorrow"].includes(value) || isValidDate(value);
}

function parseArgs(argv) {
  const args = {
    query: "",
    days: 0,
    shortages: 0,
    planDate: "",
    customer: "",
    limit: 20,
    help: false,
    selfTest: false,
  };
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--self-test") args.selfTest = true;
    else if (arg === "--shortages") {
      const value = Number(argv[index + 1]);
      if (![1, 7].includes(value)) throw new Error("--shortages chỉ nhận 1 hoặc 7.");
      args.shortages = value;
      index += 1;
    } else if (arg.startsWith("--shortages=")) {
      const value = Number(arg.slice("--shortages=".length));
      if (![1, 7].includes(value)) throw new Error("--shortages chỉ nhận 1 hoặc 7.");
      args.shortages = value;
    } else if (arg === "--plan-date") {
      const value = argv[index + 1] || "";
      if (!isValidPlanDateArg(value)) throw new Error("--plan-date chỉ nhận today, tomorrow hoặc YYYY-MM-DD.");
      args.planDate = value;
      index += 1;
    } else if (arg.startsWith("--plan-date=")) {
      const value = arg.slice("--plan-date=".length);
      if (!isValidPlanDateArg(value)) throw new Error("--plan-date chỉ nhận today, tomorrow hoặc YYYY-MM-DD.");
      args.planDate = value;
    } else if (arg === "--customer") {
      const value = argv[index + 1] || "";
      if (!value || value.startsWith("-")) throw new Error("--customer bị thiếu mã hoặc tên khách hàng.");
      args.customer = value.trim();
      index += 1;
    } else if (arg.startsWith("--customer=")) {
      args.customer = arg.slice("--customer=".length).trim();
      if (!args.customer) throw new Error("--customer bị thiếu mã hoặc tên khách hàng.");
    } else if (arg === "--limit") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 50) throw new Error("--limit chỉ nhận số từ 1 đến 50.");
      args.limit = value;
      index += 1;
    } else if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (!Number.isInteger(value) || value < 1 || value > 50) throw new Error("--limit chỉ nhận số từ 1 đến 50.");
      args.limit = value;
    } else if (arg === "--days") {
      const value = Number(argv[index + 1]);
      if (![0, 1, 7].includes(value)) throw new Error("--days chỉ nhận 0, 1 hoặc 7.");
      args.days = value;
      index += 1;
    } else if (arg.startsWith("--days=")) {
      const value = Number(arg.slice("--days=".length));
      if (![0, 1, 7].includes(value)) throw new Error("--days chỉ nhận 0, 1 hoặc 7.");
      args.days = value;
    } else if (arg.startsWith("-")) throw new Error(`Tham số không hỗ trợ: ${arg}`);
    else positionals.push(arg);
  }

  args.query = positionals.join(" ").trim();
  if (args.shortages && (args.planDate || args.customer || args.query || args.days)) {
    throw new Error("--shortages không dùng chung với mã hàng, --days, --plan-date hoặc --customer.");
  }
  if (args.planDate && args.days) throw new Error("--plan-date không dùng chung với --days.");
  if (args.customer && !args.planDate) throw new Error("--customer chỉ dùng cùng --plan-date.");
  return args;
}

async function fetchAllRows(queryBuilder, key = "id") {
  const rows = [];
  const seen = new Set();
  let from = 0;

  while (true) {
    const { data, error } = await queryBuilder.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data?.length) break;

    for (const row of data) {
      const rowKey = row[key];
      if (rowKey == null || !seen.has(String(rowKey))) {
        rows.push(row);
        if (rowKey != null) seen.add(String(rowKey));
      }
    }

    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function fetchAllRpcRows(queryBuilder) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryBuilder.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

function findMatches(products, query) {
  const needle = normalizeText(query);
  if (!needle) return [];

  const exactSku = products.filter((product) => normalizeText(product.sku) === needle);
  if (exactSku.length > 0) return exactSku;

  return products.filter((product) => [product.sku, product.name, product.spec]
    .some((value) => normalizeText(value).includes(needle)));
}

function customerLabel(customer) {
  if (!customer) return "Chưa gán khách hàng";
  return [customer.code, customer.name].filter(Boolean).join(" - ");
}

function candidateView(product, customerMap) {
  return {
    ma_hang: product.sku,
    ten_hang: product.name,
    quy_cach: product.spec ?? "",
    khach_hang: customerLabel(customerMap.get(product.customer_id)),
  };
}

function findCustomerMatches(customers, query) {
  const needle = normalizeText(query);
  if (!needle) return [];
  const exactCode = customers.filter((customer) => normalizeText(customer.code) === needle);
  if (exactCode.length > 0) return exactCode;
  return customers.filter((customer) => [customer.code, customer.name]
    .some((value) => normalizeText(value).includes(needle)));
}

function customerCandidateView(customer) {
  return { ma_khach_hang: customer.code || "", ten_khach_hang: customer.name || "" };
}

function buildDeliveryOutlook(plans, currentStock, startDate, days) {
  if (days === 0) return [];
  const lastDate = addDays(startDate, days - 1);
  const byDate = new Map();

  for (const plan of plans) {
    const remaining = Math.max(0,
      safeNumber(plan.planned_qty) + safeNumber(plan.backlog_qty) - safeNumber(plan.actual_qty));
    byDate.set(plan.plan_date, (byDate.get(plan.plan_date) || 0) + remaining);
  }

  let projectedStock = currentStock;
  const outlook = [];
  for (let date = startDate; date <= lastDate; date = addDays(date, 1)) {
    const remaining = byDate.get(date) || 0;
    const shortage = remaining > 0 && projectedStock < remaining
      ? remaining - Math.max(0, projectedStock)
      : 0;
    projectedStock -= remaining;
    if (remaining > 0 || shortage > 0) {
      outlook.push({
        ngay: date,
        con_phai_giao: remaining,
        ton_du_kien_cuoi_ngay: projectedStock,
        nguy_co_thieu: shortage,
      });
    }
  }
  return outlook;
}

function buildShortageReport(products, plans, stockMap, customerMap, startDate, days) {
  const endDate = addDays(startDate, days - 1);
  const plansByProduct = new Map();
  for (const plan of plans) {
    if (!plansByProduct.has(plan.product_id)) plansByProduct.set(plan.product_id, []);
    plansByProduct.get(plan.product_id).push(plan);
  }

  const rows = [];
  for (const product of products) {
    let runningStock = stockMap.get(product.id) || 0;
    const productPlans = plansByProduct.get(product.id) || [];
    const daily = [];

    for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
      const dayPlans = productPlans.filter((plan) => plan.plan_date === date);
      const remaining = dayPlans.reduce((sum, plan) => sum + Math.max(0,
        safeNumber(plan.planned_qty) + safeNumber(plan.backlog_qty) - safeNumber(plan.actual_qty)), 0);
      const shortageToday = remaining > 0 && runningStock < remaining
        ? remaining - Math.max(0, runningStock)
        : 0;
      runningStock -= remaining;
      if (shortageToday > 0) {
        daily.push({
          ngay: date,
          con_phai_giao: remaining,
          nguy_co_thieu_phat_sinh: shortageToday,
          thieu_luy_ke_den_ngay: Math.max(0, -runningStock),
        });
      }
    }

    if (daily.length > 0) {
      rows.push({
        ...candidateView(product, customerMap),
        ton_hien_tai: stockMap.get(product.id) || 0,
        chi_tiet_thieu: daily,
        thieu_luy_ke_cuoi_ky: Math.max(0, -runningStock),
      });
    }
  }

  return rows.sort((a, b) =>
    b.thieu_luy_ke_cuoi_ky - a.thieu_luy_ke_cuoi_ky || a.ma_hang.localeCompare(b.ma_hang, "vi"));
}

function buildPlanReport(plans, productMap, customerMap) {
  const grouped = new Map();
  for (const plan of plans) {
    const product = productMap.get(plan.product_id);
    if (!product) continue;
    const destinationCustomerId = plan.delivery_customer_id || product.customer_id;
    const key = `${plan.product_id}_${destinationCustomerId || "none"}`;
    const existing = grouped.get(key) || {
      ...candidateView(product, customerMap),
      khach_hang: customerLabel(customerMap.get(destinationCustomerId)),
      ke_hoach_goc: 0,
      backlog: 0,
      da_giao: 0,
      con_phai_giao: 0,
    };
    existing.ke_hoach_goc += safeNumber(plan.planned_qty);
    existing.backlog += safeNumber(plan.backlog_qty);
    existing.da_giao += safeNumber(plan.actual_qty);
    existing.con_phai_giao = Math.max(0, existing.ke_hoach_goc + existing.backlog - existing.da_giao);
    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).sort((a, b) =>
    a.khach_hang.localeCompare(b.khach_hang, "vi") || a.ma_hang.localeCompare(b.ma_hang, "vi"));
}

function rejectServiceRoleKey(key) {
  if (key.startsWith("sb_secret_")) throw new Error("Từ chối dùng Supabase secret/service key.");
  const parts = key.split(".");
  if (parts.length !== 3) return;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (payload.role === "service_role") throw new Error("Từ chối dùng Supabase service_role.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("service_role")) throw error;
  }
}

async function verifyReadOnlyAccount(supabase, userId) {
  const [{ data: profile, error: profileError }, managerCheck, adminCheck, planWriteCheck] = await Promise.all([
    supabase.from("profiles")
      .select("id, role, department, is_active, is_approved, deleted_at")
      .eq("id", userId)
      .maybeSingle(),
    supabase.rpc("is_manager"),
    supabase.rpc("is_admin"),
    supabase.rpc("can_edit_delivery_plan"),
  ]);

  if (profileError) throw profileError;
  if (!profile || profile.deleted_at || !profile.is_active || !profile.is_approved) {
    throw new Error("Tài khoản OpenClaw chưa được duyệt, đã bị khóa hoặc không có hồ sơ hợp lệ.");
  }
  if (managerCheck.error) throw managerCheck.error;
  if (adminCheck.error) throw adminCheck.error;
  if (planWriteCheck.error) throw planWriteCheck.error;

  const isReadOnlyWarehouseStaff = normalizeText(profile.department) === "warehouse";
  if (profile.role !== "staff" || managerCheck.data === true || adminCheck.data === true ||
      planWriteCheck.data === true || !isReadOnlyWarehouseStaff) {
    throw new Error("Từ chối chạy: tài khoản OpenClaw đang có quyền quản lý hoặc quyền ghi dữ liệu.");
  }
  return profile;
}

async function fetchCurrentStockMap(supabase, today) {
  const lookback30 = getDaysAgo(today, 30);
  const openings = await fetchAllRows(supabase.from("inventory_opening_balances")
    .select("id, period_month, source_stocktake_id, deleted_at")
    .is("deleted_at", null)
    .lte("period_month", `${today}T23:59:59.999Z`)
    .order("id", { ascending: true }));
  const bounds = computeSnapshotBounds(lookback30, today, openings);

  if (ALLOWED_BUSINESS_RPC !== "inventory_calculate_product_stock_v1") {
    throw new Error("RPC tính tồn không nằm trong danh sách chỉ đọc.");
  }
  const stockRows = await fetchAllRpcRows(supabase.rpc(ALLOWED_BUSINESS_RPC, {
    p_baseline_date: bounds.S || lookback30,
    p_movements_start_date: bounds.effectiveStart,
    p_movements_end_date: addDays(today, 1),
  }).order("product_id", { ascending: true }));

  const stockMap = new Map();
  for (const row of stockRows) {
    stockMap.set(row.product_id, (stockMap.get(row.product_id) || 0) + safeNumber(row.current_qty));
  }
  return stockMap;
}

async function runLookup(args) {
  loadLocalEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.OPENCLAW_PP_EMAIL;
  const password = process.env.OPENCLAW_PP_PASSWORD;
  if (!url || !anonKey || !email || !password) {
    throw new Error("Thiếu URL/anon key trong .env.local hoặc tài khoản trong .env.openclaw.local.");
  }
  rejectServiceRoleKey(anonKey);

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError || !authData.user) throw authError || new Error("Đăng nhập OpenClaw thất bại.");

  try {
    await verifyReadOnlyAccount(supabase, authData.user.id);

    const [products, customers] = await Promise.all([
      fetchAllRows(supabase.from("products")
        .select("id, sku, name, spec, customer_id")
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("sku", { ascending: true })
        .order("id", { ascending: true })),
      fetchAllRows(supabase.from("customers")
        .select("id, code, name, parent_customer_id")
        .is("deleted_at", null)
        .order("id", { ascending: true })),
    ]);
    const customerMap = new Map(customers.map((customer) => [customer.id, customer]));
    const productMap = new Map(products.map((product) => [product.id, product]));
    const today = getTodayVNStr();
    const planDate = args.planDate === "today"
      ? today
      : args.planDate === "tomorrow"
        ? addDays(today, 1)
        : args.planDate;

    if (args.shortages > 0) {
      const endDate = addDays(today, args.shortages - 1);
      const [stockMap, plans] = await Promise.all([
        fetchCurrentStockMap(supabase, today),
        fetchAllRows(supabase.from("delivery_plans")
          .select("id, product_id, plan_date, planned_qty, backlog_qty, actual_qty")
          .gte("plan_date", today)
          .lte("plan_date", endDate)
          .is("deleted_at", null)
          .or("planned_qty.gt.0,backlog_qty.gt.0")
          .order("id", { ascending: true })),
      ]);
      const shortageRows = buildShortageReport(products, plans, stockMap, customerMap, today, args.shortages);
      return {
        status: "ok",
        che_do: "danh_sach_nguy_co_thieu",
        tu_ngay: today,
        den_ngay: endDate,
        tong_so_ma_thieu: shortageRows.length,
        danh_sach: shortageRows.slice(0, args.limit),
        da_cat_danh_sach: shortageRows.length > args.limit,
        gioi_han: args.limit,
      };
    }

    if (planDate) {
      let selectedCustomer = null;
      if (args.customer) {
        const customerMatches = findCustomerMatches(customers, args.customer);
        if (customerMatches.length === 0) {
          return {
            status: "not_found",
            loai: "khach_hang",
            can_tu_chon: false,
            cau_hoi: `Không tìm thấy khách hàng phù hợp với “${args.customer}”.`,
          };
        }
        if (customerMatches.length !== 1) {
          return {
            status: "needs_confirmation",
            loai: "khach_hang",
            can_tu_chon: false,
            tong_so_ket_qua: customerMatches.length,
            danh_sach: customerMatches.slice(0, MAX_CANDIDATES).map(customerCandidateView),
            da_cat_danh_sach: customerMatches.length > MAX_CANDIDATES,
            cau_hoi: "Có nhiều khách hàng gần giống. Vui lòng chọn đúng mã khách hàng; bot không được tự chọn.",
          };
        }
        [selectedCustomer] = customerMatches;
      }

      let selectedProduct = null;
      if (args.query) {
        const productMatches = findMatches(products, args.query);
        if (productMatches.length === 0) {
          return { status: "not_found", loai: "ma_hang", can_tu_chon: false, cau_hoi: `Không tìm thấy mã phù hợp với “${args.query}”.` };
        }
        if (productMatches.length !== 1) {
          return {
            status: "needs_confirmation",
            loai: "ma_hang",
            can_tu_chon: false,
            tong_so_ket_qua: productMatches.length,
            danh_sach: productMatches.slice(0, MAX_CANDIDATES).map((product) => candidateView(product, customerMap)),
            da_cat_danh_sach: productMatches.length > MAX_CANDIDATES,
            cau_hoi: "Có nhiều mã gần giống. Vui lòng chọn đúng mã hàng; bot không được tự chọn.",
          };
        }
        [selectedProduct] = productMatches;
      }

      let planQuery = supabase.from("delivery_plans")
        .select("id, product_id, customer_id, delivery_customer_id, plan_date, planned_qty, backlog_qty, actual_qty")
        .eq("plan_date", planDate)
        .is("deleted_at", null)
        .or("planned_qty.gt.0,backlog_qty.gt.0")
        .order("id", { ascending: true });
      if (selectedProduct) planQuery = planQuery.eq("product_id", selectedProduct.id);
      let plans = await fetchAllRows(planQuery);
      if (selectedCustomer) {
        plans = plans.filter((plan) => {
          const product = productMap.get(plan.product_id);
          if (!product) return false;
          const destinationCustomerId = plan.delivery_customer_id || product.customer_id;
          const destinationCustomer = customerMap.get(destinationCustomerId);
          return destinationCustomerId === selectedCustomer.id ||
            product.customer_id === selectedCustomer.id ||
            destinationCustomer?.parent_customer_id === selectedCustomer.id;
        });
      }
      const planRows = buildPlanReport(plans, productMap, customerMap);
      return {
        status: "ok",
        che_do: "ke_hoach_giao_theo_ngay",
        ngay: planDate,
        bo_loc_khach_hang: selectedCustomer ? customerCandidateView(selectedCustomer) : null,
        bo_loc_ma_hang: selectedProduct ? candidateView(selectedProduct, customerMap) : null,
        tong_so_dong: planRows.length,
        danh_sach: planRows.slice(0, args.limit),
        da_cat_danh_sach: planRows.length > args.limit,
        gioi_han: args.limit,
      };
    }

    const matches = findMatches(products, args.query);

    if (matches.length === 0) {
      return { status: "not_found", can_tu_chon: false, cau_hoi: `Không tìm thấy mã phù hợp với “${args.query}”.` };
    }
    if (matches.length !== 1) {
      return {
        status: "needs_confirmation",
        can_tu_chon: false,
        tong_so_ket_qua: matches.length,
        danh_sach: matches.slice(0, MAX_CANDIDATES).map((product) => candidateView(product, customerMap)),
        da_cat_danh_sach: matches.length > MAX_CANDIDATES,
        cau_hoi: "Có nhiều mã gần giống. Vui lòng chọn đúng mã hàng; bot không được tự chọn.",
      };
    }

    const product = matches[0];
    const stockMap = await fetchCurrentStockMap(supabase, today);
    const currentStock = stockMap.get(product.id) || 0;

    let outlook = [];
    if (args.days > 0) {
      const plans = await fetchAllRows(supabase.from("delivery_plans")
        .select("id, product_id, plan_date, planned_qty, backlog_qty, actual_qty")
        .eq("product_id", product.id)
        .gte("plan_date", today)
        .lte("plan_date", addDays(today, args.days - 1))
        .is("deleted_at", null)
        .order("id", { ascending: true }));
      outlook = buildDeliveryOutlook(plans, currentStock, today, args.days);
    }

    return {
      status: "ok",
      ngay_tinh_ton: today,
      san_pham: { ...candidateView(product, customerMap), ton_hien_tai: currentStock },
      pham_vi_ke_hoach_ngay: args.days,
      ke_hoach_va_nguy_co_thieu: outlook,
      canh_bao: outlook.some((row) => row.nguy_co_thieu > 0)
        ? "Có nguy cơ thiếu theo kế hoạch trong phạm vi đã chọn."
        : null,
    };
  } finally {
    await supabase.auth.signOut({ scope: "local" });
  }
}

function printHelp() {
  process.stdout.write([
    "Tra cứu kho PP chỉ đọc cho OpenClaw.",
    "",
    "Cách dùng:",
    "  node D:\\pp\\scripts\\openclaw-pp-readonly.mjs \"MA-HANG\"",
    "  node D:\\pp\\scripts\\openclaw-pp-readonly.mjs \"tên hoặc quy cách\" --days 7",
    "  node D:\\pp\\scripts\\openclaw-pp-readonly.mjs --shortages 1",
    "  node D:\\pp\\scripts\\openclaw-pp-readonly.mjs --shortages 7 --limit 20",
    "  node D:\\pp\\scripts\\openclaw-pp-readonly.mjs --plan-date 2026-07-15",
    "  node D:\\pp\\scripts\\openclaw-pp-readonly.mjs --plan-date today",
    "  node D:\\pp\\scripts\\openclaw-pp-readonly.mjs --plan-date tomorrow",
    "  node D:\\pp\\scripts\\openclaw-pp-readonly.mjs --plan-date 2026-07-15 --customer \"MA-KHACH\"",
    "  node D:\\pp\\scripts\\openclaw-pp-readonly.mjs \"MA-HANG\" --plan-date 2026-07-15",
    "",
    "--days 0: chỉ tồn hiện tại (mặc định)",
    "--days 1: thêm kế hoạch/nguy cơ thiếu hôm nay",
    "--days 7: thêm kế hoạch/nguy cơ thiếu 7 ngày",
    "--shortages 1|7: danh sách tất cả mã active có nguy cơ thiếu",
    "--plan-date today|tomorrow|YYYY-MM-DD: kế hoạch giao của một ngày",
    "--customer: lọc kế hoạch theo mã hoặc tên khách hàng",
    "--limit 1..50: giới hạn số dòng trả về, mặc định 20",
    "--self-test: kiểm tra logic local, không kết nối Supabase",
  ].join("\n") + "\n");
}

function runSelfTest() {
  const products = [
    { id: "1", sku: "ABC-01", name: "Thùng carton", spec: "Dài 10", is_active: true },
    { id: "2", sku: "ABC-02", name: "Thùng carton", spec: "Dài 20", is_active: true },
  ];
  if (findMatches(products, "abc-01").length !== 1) throw new Error("Self-test mã duy nhất thất bại.");
  if (findMatches(products, "thung").length !== 2) throw new Error("Self-test nhiều mã thất bại.");
  if (findMatches(products, "khong-co").length !== 0) throw new Error("Self-test không tồn tại thất bại.");
  const manualBounds = computeSnapshotBounds("2026-07-01", "2026-07-15", [
    { period_month: "2026-07-10", source_stocktake_id: null, deleted_at: null },
  ]);
  if (manualBounds.effectiveStart !== "2026-07-10") throw new Error("Self-test mốc đầu ngày thất bại.");
  const stocktakeBounds = computeSnapshotBounds("2026-07-01", "2026-07-15", [
    { period_month: "2026-07-10", source_stocktake_id: "stocktake-1", deleted_at: null },
  ]);
  if (stocktakeBounds.effectiveStart !== "2026-07-11") throw new Error("Self-test mốc cuối ngày thất bại.");
  const outlook = buildDeliveryOutlook([
    { plan_date: "2026-07-15", planned_qty: 8, backlog_qty: 0, actual_qty: 0 },
    { plan_date: "2026-07-16", planned_qty: 5, backlog_qty: 0, actual_qty: 0 },
  ], 10, "2026-07-15", 7);
  if (outlook[1]?.nguy_co_thieu !== 3) throw new Error("Self-test dự báo thiếu thất bại.");
  const customerMap = new Map([["c1", { id: "c1", code: "KH1", name: "Khách 1" }]]);
  const shortageRows = buildShortageReport(
    [{ id: "1", sku: "ABC-01", name: "Thùng carton", spec: "Dài 10", customer_id: "c1" }],
    [
      { product_id: "1", plan_date: "2026-07-15", planned_qty: 8, backlog_qty: 0, actual_qty: 0 },
      { product_id: "1", plan_date: "2026-07-16", planned_qty: 5, backlog_qty: 0, actual_qty: 0 },
    ],
    new Map([["1", 10]]),
    customerMap,
    "2026-07-15",
    7,
  );
  if (shortageRows[0]?.thieu_luy_ke_cuoi_ky !== 3) throw new Error("Self-test danh sách thiếu thất bại.");
  const planRows = buildPlanReport([
    { product_id: "1", customer_id: "c1", delivery_customer_id: null, planned_qty: 10, backlog_qty: 2, actual_qty: 4 },
  ], new Map([["1", { id: "1", sku: "ABC-01", name: "Thùng carton", spec: "Dài 10", customer_id: "c1" }]]), customerMap);
  if (planRows[0]?.con_phai_giao !== 8) throw new Error("Self-test kế hoạch giao thất bại.");
  if (parseArgs(["--shortages", "7", "--limit", "10"]).shortages !== 7) throw new Error("Self-test tham số thiếu hàng thất bại.");
  if (parseArgs(["--plan-date", "2026-07-15", "--customer", "KH1"]).customer !== "KH1") throw new Error("Self-test tham số kế hoạch thất bại.");
  return { status: "self_test_ok", ket_noi_supabase: false };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) return printHelp();
    if (args.selfTest) return process.stdout.write(`${JSON.stringify(runSelfTest(), null, 2)}\n`);
    if (!args.query && !args.shortages && !args.planDate) {
      throw new Error("Thiếu mã hàng hoặc chế độ --shortages/--plan-date cần tra cứu.");
    }
    const result = await runLookup(args);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lỗi không xác định.";
    process.stderr.write(`${JSON.stringify({ status: "error", message }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectRun) await main();

export {
  buildDeliveryOutlook,
  buildPlanReport,
  buildShortageReport,
  findCustomerMatches,
  findMatches,
  getTodayVNStr,
  normalizeText,
  parseArgs,
  rejectServiceRoleKey,
};
