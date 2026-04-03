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

    // 4. Tuyệt đối KHÔNG tự ý giãn cột hay sửa border của người dùng ở đây.

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `${filename}.xlsx`);
  } catch (error) {
    console.error("Lỗi ExcelJS:", error);
    throw error;
  }
}

export async function readExcel(file: File): Promise<any[]> {
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

export function exportToExcel(data: any[], filename: string, sheetName: string = "Sheet1") {
   const xlsx = require('xlsx');
   const ws = xlsx.utils.json_to_sheet(data);
   const wb = xlsx.utils.book_new();
   xlsx.utils.book_append_sheet(wb, ws, sheetName);
   xlsx.writeFile(wb, `${filename}.xlsx`);
}

/**
 * Xuất nháp Kế hoạch Giao hàng hôm nay dùng đúng file mẫu maukehoachgiaohang.xlsx
 * - Giữ nguyên định dạng A1, A2, B2, C2, D2, E2
 * - A3+ = dữ liệu từng mã: STT, Tên KH, Mã nội bộ, Tên hàng, Số lượng kế hoạch
 * - Tự kẻ bảng cho từng dòng dữ liệu
 */
export async function exportDeliveryDraftExcel(
  items: {
    customerName: string;
    sku: string;
    productName: string;
    plannedQty: number;
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
  // Giữ merge A1:E1
  try { ws.unMergeCells('A1:E1'); } catch (_) {}
  ws.mergeCells('A1:E1');

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

    // Tên Khách hàng
    const c2 = row.getCell(2);
    c2.value = item.customerName;
    c2.font = { name: 'Times New Roman', size: 13 };
    c2.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
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

    row.height = 20;
    row.commit();
  });

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), `${filename}.xlsx`);
}
