import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

export type ExcelFont = {
    name?: string;
    size?: number;
    bold?: boolean;
    color?: { argb: string };
};

export type CellInfo = {
    value: string | number | null;
    font?: ExcelFont;
};

const MAX_EXCEL_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_EXCEL_IMPORT_ROWS = 5000;
const ALLOWED_EXCEL_IMPORT_EXTENSIONS = [".xlsx", ".xlsm"];

function assertSafeExcelImportFile(file: File) {
  const lowerName = file.name.toLowerCase();
  const hasAllowedExtension = ALLOWED_EXCEL_IMPORT_EXTENSIONS.some((ext) => lowerName.endsWith(ext));

  if (!hasAllowedExtension) {
    throw new Error("Chỉ hỗ trợ file Excel .xlsx hoặc .xlsm.");
  }
  if (file.size <= 0) {
    throw new Error("File Excel đang trống.");
  }
  if (file.size > MAX_EXCEL_IMPORT_BYTES) {
    throw new Error("File Excel quá lớn. Vui lòng dùng file không quá 5MB.");
  }
}

/**
 * Tiêm dữ liệu vào một file mẫu Excel có sẵn (Dùng ExcelJS để giữ định dạng)
 */
export async function exportWithTemplate(
  templateUrl: string, 
  cellData: Record<string, string | number | null | CellInfo>, 
  tableData: any[][], 
  tableStartRow: number,
  filename: string,
  rowOffset: number = 0
) {
  try {
    const response = await fetch(templateUrl);
    if (!response.ok) throw new Error("Không thể tải file mẫu (.xlsx).");
    const arrayBuffer = await response.arrayBuffer();
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error("File mẫu không có sheet nào.");

    // Luôn ép vùng in vừa đúng một trang A4, kể cả khi có thêm dòng hàng.
    worksheet.pageSetup = {
      ...worksheet.pageSetup,
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      printArea: `A1:H${22 + rowOffset}`,
    };

    // 1. Chèn thêm dòng nếu nhiều mã hàng
    if (rowOffset > 0) {
      worksheet.duplicateRow(tableStartRow, rowOffset, true);
      
      // FIX LỖI GỘP Ô Ở FOOTER (Phẫu thuật chính xác theo tọa độ file mẫu 11.8KB)
      const totalRow = 17 + rowOffset;
      const sigHdr = 19 + rowOffset;
      const sigNames = 20 + rowOffset;
      const sigTitles = 21 + rowOffset;

      // Unmerge trước để tránh lỗi, sau đó merge lại theo vị trí mới
      try { worksheet.unMergeCells(`A${totalRow}:F${totalRow}`); } catch(e){}
      worksheet.mergeCells(`A${totalRow}:F${totalRow}`);
      
      try { worksheet.unMergeCells(`A${sigHdr}:E${sigHdr}`); } catch(e){}
      worksheet.mergeCells(`A${sigHdr}:E${sigHdr}`);
      try { worksheet.unMergeCells(`F${sigHdr}:H${sigHdr}`); } catch(e){}
      worksheet.mergeCells(`F${sigHdr}:H${sigHdr}`);

      try { worksheet.unMergeCells(`A${sigNames}:E${sigNames}`); } catch(e){}
      worksheet.mergeCells(`A${sigNames}:E${sigNames}`);
      try { worksheet.unMergeCells(`F${sigNames}:H${sigNames}`); } catch(e){}
      worksheet.mergeCells(`F${sigNames}:H${sigNames}`);

      try { worksheet.unMergeCells(`A${sigTitles}:C${sigTitles}`); } catch(e){}
      worksheet.mergeCells(`A${sigTitles}:C${sigTitles}`);
      try { worksheet.unMergeCells(`D${sigTitles}:E${sigTitles}`); } catch(e){}
      worksheet.mergeCells(`D${sigTitles}:E${sigTitles}`);
      try { worksheet.unMergeCells(`F${sigTitles}:H${sigTitles}`); } catch(e){}
      worksheet.mergeCells(`F${sigTitles}:H${sigTitles}`);
    }

    // 2. Điền Header/Footer Data
    Object.entries(cellData).forEach(([address, data]) => {
      const cell = worksheet.getCell(address);
      if (data === null || data === undefined) return;
      
      if (typeof data === 'object' && 'value' in data) {
        // Nếu value là null thì không ghi đè nội dung, chỉ chỉnh font nếu có
        if (data.value !== null && data.value !== undefined) {
          cell.value = data.value;
        }
        if (data.font) {
          cell.font = { ...cell.font, ...data.font };
        }
      } else {
        cell.value = data;
      }
    });

    // 3. Điền Dữ liệu Bảng (Giữ định dạng gốc, chỉ ép Font 13 cho các ô dữ liệu)
    tableData.forEach((rowData, i) => {
      const currentRow = tableStartRow + i;
      const rowObj = worksheet.getRow(currentRow);
      rowData.forEach((val, j) => {
        const cell = rowObj.getCell(j + 1);
        cell.value = val;
        // Chỉ thay đổi Font sang 13 TNR cho các ô dữ liệu trong bảng
        cell.font = { name: 'Times New Roman', size: 13 };
      });
    });

    // Kiểu của Excel Table có thể ghi đè font header khi mở file.
    // Ép lại ở bước cuối để A15:H15 luôn in đậm trong file tải xuống.
    for (let col = 1; col <= 8; col += 1) {
      const headerCell = worksheet.getCell(15, col);
      headerCell.font = {
        ...headerCell.font,
        name: 'Times New Roman',
        size: 13,
        bold: true,
      };
    }

    // 4. Tuyệt đối KHÔNG tự ý giãn cột hay sửa border của người dùng ở đây.

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `${filename}.xlsx`);
  } catch (error) {
    console.error("Lỗi ExcelJS:", error);
    throw error;
  }
}

export async function readExcel(file: File): Promise<any[]> {
    assertSafeExcelImportFile(file);

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const buffer = e.target?.result as ArrayBuffer;
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(buffer);
          const worksheet = workbook.worksheets[0];
          const rows: any[] = [];
          worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > MAX_EXCEL_IMPORT_ROWS + 1) {
              throw new Error(`File Excel vượt quá ${MAX_EXCEL_IMPORT_ROWS} dòng dữ liệu.`);
            }
            if (rowNumber > 1) {
              const rowValues = Array.isArray(row.values) ? row.values.slice(1) : [];
              rows.push(rowValues);
            }
          });
          resolve(rows);
        } catch (err) { reject(err); }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
    });
}

function safeExcelValue(value: unknown): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;

  const text = String(value);
  // Security: prevent user-controlled text from being interpreted as an Excel formula.
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function normalizeExcelFilename(filename: string): string {
  return filename.toLowerCase().endsWith(".xlsx") ? filename : `${filename}.xlsx`;
}

export function exportToExcel(data: any[], filename: string, sheetName: string = "Sheet1") {
  void (async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetName || "Sheet1");
    const headers = Array.from(
      data.reduce((keys: Set<string>, row) => {
        if (row && typeof row === "object") {
          Object.keys(row).forEach((key) => keys.add(key));
        }
        return keys;
      }, new Set<string>())
    );

    if (headers.length > 0) {
      const headerRow = worksheet.addRow(headers);
      headerRow.font = { bold: true };
      data.forEach((row) => {
        worksheet.addRow(headers.map((header) => safeExcelValue(row?.[header])));
      });
      worksheet.columns.forEach((column, index) => {
        const header = headers[index] || "";
        let maxLength = header.length;
        column.eachCell?.({ includeEmpty: false }, (cell) => {
          maxLength = Math.max(maxLength, String(cell.value ?? "").length);
        });
        column.width = Math.min(Math.max(maxLength + 2, 10), 42);
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), normalizeExcelFilename(filename));
  })().catch((error) => {
    console.error("Loi xuat Excel:", error);
  });
}

export async function exportDeliveryFuturePlanMatrixExcel(
  rows: {
    customerName: string;
    sku: string;
    uom: string;
    totalRemaining: number;
    quantitiesByDate: Record<string, number>;
  }[],
  dates: string[],
  filename: string
) {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Ke hoach tong');

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  };
  const blueFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0070C0' } };
  const lightBlueFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };

  ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 2 }];
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 2, column: 4 + dates.length },
  };

  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 24;
  ws.getColumn(3).width = 10;
  ws.getColumn(4).width = 16;
  dates.forEach((_, idx) => {
    ws.getColumn(5 + idx).width = 11;
  });

  const fixedHeaders = ['Khách hàng', 'Mã liệu', 'Đơn vị', 'Tổng SL cần giao'];
  fixedHeaders.forEach((label, idx) => {
    const col = idx + 1;
    const cell = ws.getCell(1, col);
    cell.value = label;
    cell.fill = blueFill;
    cell.font = { name: 'Times New Roman', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = thinBorder;
    ws.mergeCells(1, col, 2, col);
  });

  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  dates.forEach((dateStr, idx) => {
    const col = 5 + idx;
    const d = new Date(`${dateStr}T00:00:00`);
    const day = d.getDay();
    const dateCell = ws.getCell(1, col);
    dateCell.value = `${String(d.getDate()).padStart(2, '0')}-Thg${d.getMonth() + 1}`;
    dateCell.fill = blueFill;
    dateCell.font = { name: 'Times New Roman', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    dateCell.alignment = { horizontal: 'center', vertical: 'middle' };
    dateCell.border = thinBorder;

    const weekdayCell = ws.getCell(2, col);
    weekdayCell.value = weekdayLabels[day];
    weekdayCell.fill = lightBlueFill;
    weekdayCell.font = {
      name: 'Times New Roman',
      size: 11,
      bold: day === 0 || day === 6,
      color: { argb: day === 0 || day === 6 ? 'FFC00000' : 'FF000000' },
    };
    weekdayCell.alignment = { horizontal: 'center', vertical: 'middle' };
    weekdayCell.border = thinBorder;
  });

  ws.getRow(1).height = 20;
  ws.getRow(2).height = 18;

  rows.forEach((item, rowIdx) => {
    const rowNum = 3 + rowIdx;
    [item.customerName, item.sku, item.uom, item.totalRemaining].forEach((value, idx) => {
      const cell = ws.getCell(rowNum, idx + 1);
      cell.value = value;
      cell.font = { name: 'Times New Roman', size: 11 };
      cell.alignment = { horizontal: idx <= 1 ? 'left' : 'center', vertical: 'middle', wrapText: idx === 0 };
      cell.border = thinBorder;
    });

    dates.forEach((dateStr, idx) => {
      const qty = item.quantitiesByDate[dateStr] || 0;
      const cell = ws.getCell(rowNum, 5 + idx);
      cell.value = qty > 0 ? qty : null;
      cell.font = { name: 'Times New Roman', size: 11 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = thinBorder;
    });
    ws.getRow(rowNum).height = 18;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), `${filename}.xlsx`);
}

/**
 * Xuất nháp Kế hoạch Giao hàng hôm nay dùng đúng file mẫu maukehoachgiaohang.xlsx
 * - Giữ nguyên định dạng A1, A2, B2, C2, D2, E2
 * - A3+ = dữ liệu từng mã: STT, Mã KH/Vendor, Mã nội bộ, Tên hàng, Số lượng kế hoạch, Lưu ý 1, Lưu ý 2
 * - Tự kẻ bảng cho từng dòng dữ liệu
 */
export async function exportDeliveryDraftExcel(
  items: {
    customerCode: string;
    sku: string;
    productName: string;
    plannedQty: number;
    note1: string;
    note2: string;
  }[],
  dateLabel: string,
  filename: string
) {
  const response = await fetch('/templates/maukehoachgiaohang.xlsx');
  if (!response.ok) throw new Error('Không thể tải file mẫu kế hoạch giao hàng.');
  const arrayBuffer = await response.arrayBuffer();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  const ws = workbook.worksheets[0];
  if (!ws) throw new Error('File mẫu không hợp lệ.');

  // Cập nhật tiêu đề A1 với ngày
  const titleCell = ws.getCell('A1');
  titleCell.value = `KẾ HOẠCH GIAO HÀNG - NGÀY ${dateLabel}`;
  // Giữ tiêu đề phủ hết các cột đang xuất
  try { ws.unMergeCells('A1:E1'); } catch (_) {}
  try { ws.unMergeCells('A1:G1'); } catch (_) {}
  ws.mergeCells('A1:G1');

  const headerLabels = ['#', 'Khách hàng', 'Mã nội bộ', 'Tên hàng', 'Số lượng theo kế hoạch', 'Lưu ý 1', 'Lưu ý 2'];
  const headerRow = ws.getRow(2);
  const headerTemplate = headerRow.getCell(5);
  headerLabels.forEach((label, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = label;
    cell.font = headerTemplate.font;
    cell.fill = headerTemplate.fill;
    cell.alignment = headerTemplate.alignment;
    cell.border = headerTemplate.border;
  });
  ws.getColumn(2).width = 14;
  ws.getColumn(6).width = 24;
  ws.getColumn(7).width = 24;

  // Border style dùng cho từng ô dữ liệu
  const thinBorder: Partial<ExcelJS.Borders> = {
    top:    { style: 'thin' },
    left:   { style: 'thin' },
    bottom: { style: 'thin' },
    right:  { style: 'thin' },
  };

  // Ghi dữ liệu từ dòng 3 trở đi
  items.forEach((item, idx) => {
    const rowNum = 3 + idx;
    const row = ws.getRow(rowNum);

    // STT
    const c1 = row.getCell(1);
    c1.value = idx + 1;
    c1.font = { name: 'Times New Roman', size: 13 };
    c1.alignment = { horizontal: 'center', vertical: 'middle' };
    c1.border = thinBorder;

    // Mã Khách hàng / Vendor
    const c2 = row.getCell(2);
    c2.value = item.customerCode;
    c2.font = { name: 'Times New Roman', size: 13 };
    c2.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c2.border = thinBorder;

    // Mã nội bộ
    const c3 = row.getCell(3);
    c3.value = item.sku;
    c3.font = { name: 'Times New Roman', size: 13 };
    c3.alignment = { horizontal: 'center', vertical: 'middle' };
    c3.border = thinBorder;

    // Tên hàng
    const c4 = row.getCell(4);
    c4.value = item.productName;
    c4.font = { name: 'Times New Roman', size: 13 };
    c4.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    c4.border = thinBorder;

    // Số lượng kế hoạch
    const c5 = row.getCell(5);
    c5.value = item.plannedQty;
    c5.font = { name: 'Times New Roman', size: 13, bold: true };
    c5.alignment = { horizontal: 'center', vertical: 'middle' };
    c5.border = thinBorder;

    // Lưu ý 1
    const c6 = row.getCell(6);
    c6.value = item.note1;
    c6.font = { name: 'Times New Roman', size: 13 };
    c6.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    c6.border = thinBorder;

    // Lưu ý 2
    const c7 = row.getCell(7);
    c7.value = item.note2;
    c7.font = { name: 'Times New Roman', size: 13 };
    c7.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    c7.border = thinBorder;

    row.height = 20;
    row.commit();
  });

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), `${filename}.xlsx`);
}
