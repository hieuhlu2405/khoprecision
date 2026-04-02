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
 * Tiêm dữ liệu vào một file mẫu Excel có sẵn (Dùng ExcelJS giữ định dạng)
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
    
    // Đọc workbook
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error("File mẫu không có sheet nào.");

    // 1. Chèn thêm dòng nếu nhiều mã hàng và XỬ LÝ GỘP Ô CHI TIẾT
    if (rowOffset > 0) {
      worksheet.duplicateRow(tableStartRow, rowOffset, true);
      
      // LOGIC "SỬA DỨT ĐIỂM": Gộp lại Footer (Excel không tự đẩy merge phía dưới)
      const totalRow = 17 + rowOffset;
      const sigRow1 = 19 + rowOffset; // BÊN GIAO - BÊN NHẬN
      const sigRow2 = 20 + rowOffset; // TÊN PHÁP NHÂN - TÊN KHÁCH
      const sigRow3 = 21 + rowOffset; // THỦ KHO - NGƯỜI GIAO - KÝ TÊN

      // Gộp dòng Tổng cộng (A-F)
      worksheet.unMergeCells(`A${totalRow}:F${totalRow}`);
      worksheet.mergeCells(`A${totalRow}:F${totalRow}`);
      
      // Gộp dòng Bên Giao / Bên Nhận
      worksheet.unMergeCells(`A${sigRow1}:E${sigRow1}`);
      worksheet.mergeCells(`A${sigRow1}:E${sigRow1}`);
      worksheet.unMergeCells(`F${sigRow1}:H${sigRow1}`);
      worksheet.mergeCells(`F${sigRow1}:H${sigRow1}`);

      // Gộp dòng Tên Pháp Nhân / Khách Hàng
      worksheet.unMergeCells(`A${sigRow2}:E${sigRow2}`);
      worksheet.mergeCells(`A${sigRow2}:E${sigRow2}`);
      worksheet.unMergeCells(`F${sigRow2}:H${sigRow2}`);
      worksheet.mergeCells(`F${sigRow2}:H${sigRow2}`);

      // Gộp dòng Ký tên (Dòng 21 gốc)
      worksheet.unMergeCells(`A${sigRow3}:C${sigRow3}`);
      worksheet.mergeCells(`A${sigRow3}:C${sigRow3}`);
      worksheet.unMergeCells(`D${sigRow3}:E${sigRow3}`);
      worksheet.mergeCells(`D${sigRow3}:E${sigRow3}`);
      worksheet.unMergeCells(`F${sigRow3}:H${sigRow3}`);
      worksheet.mergeCells(`F${sigRow3}:H${sigRow3}`);
    }

    // 2. Điền Header/Footer Data
    Object.entries(cellData).forEach(([address, data]) => {
      const cell = worksheet.getCell(address);
      if (data === null || data === undefined) return;
      if (typeof data === 'object' && 'value' in data) {
        cell.value = data.value;
        if (data.font) cell.font = { ...cell.font, ...data.font };
      } else {
        cell.value = data;
      }
    });

    // 3. Điền Dữ liệu Bảng (Font 13 Times New Roman)
    tableData.forEach((rowData, i) => {
      const currentRow = tableStartRow + i;
      const rowObj = worksheet.getRow(currentRow);
      rowData.forEach((val, j) => {
        const cell = rowObj.getCell(j + 1);
        cell.value = val;
        // Ép Font 13 cho bảng dữ liệu
        cell.font = { name: 'Times New Roman', size: 13 };
        cell.border = {
            top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'}
        };
        // Căn giữa STT và Qty
        if (j === 0 || j === 6) cell.alignment = { horizontal: 'center' };
      });
    });

    // 4. TIẾT KIỆM GIẤY: Tính toán độ rộng cột thủ công
    for (let i = 1; i <= 8; i++) { // Cột A-H
        const col = worksheet.getColumn(i);
        let maxLen = 0;
        col.eachCell({ includeEmpty: true }, (cell) => {
            if (!cell || !cell.value) return;
            const l = cell.value.toString().length;
            if (l > maxLen) maxLen = l;
        });
        // Heuristic: Min/Max cho từng cột
        const colMap: Record<number, { min: number, max: number }> = {
            1: { min: 5, max: 8 },    // STT
            2: { min: 12, max: 20 },  // SKU
            3: { min: 12, max: 20 },  // SAP
            4: { min: 12, max: 20 },  // NCC
            5: { min: 30, max: 50 },  // Tên hàng
            6: { min: 6, max: 10 },   // ĐVT
            7: { min: 8, max: 12 },   // Qty
            8: { min: 10, max: 20 },  // Ghi chú
        };
        const config = colMap[i] || { min: 10, max: 30 };
        let finalWidth = maxLen + 2;
        if (finalWidth < config.min) finalWidth = config.min;
        if (finalWidth > config.max) finalWidth = config.max;
        col.width = finalWidth;
        // Bật WrapText cho các cột dài
        if (i === 5) {
            col.alignment = { wrapText: true, vertical: 'middle' };
        }
    }

    // 5. Xuất file
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
