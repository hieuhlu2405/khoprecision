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
 * tableStartRow: dòng bắt đầu bảng (vd: 16)
 * footerRowsToMerge: các dòng ở phần footer cần gộp lại theo mẫu A:F, A:E, F:H v.v.
 */
export async function exportWithTemplate(
  templateUrl: string, 
  cellData: Record<string, string | number | null | CellInfo>, 
  tableData: any[][], 
  tableStartRow: number,
  filename: string,
  rowOffset: number = 0 // Số dòng đã chèn thêm
) {
  try {
    const response = await fetch(templateUrl);
    if (!response.ok) throw new Error("Không thể tải file mẫu (.xlsx).");
    const arrayBuffer = await response.arrayBuffer();
    
    // Đọc workbook bằng ExcelJS
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);
    
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error("File mẫu không có sheet nào.");

    // 1. Chèn thêm dòng nếu nhiều mã hàng
    if (rowOffset > 0) {
      worksheet.duplicateRow(tableStartRow, rowOffset, true);
      
      // FIX LỖI GỘP Ô Ở FOOTER: ExcelJS k tự đẩy merge vùng phía dưới
      // Gộp lại vùng Tổng cộng (A-F) - Dòng 17 gốc nay là 17 + offset
      const totalRow = 17 + rowOffset;
      worksheet.unMergeCells(`A${totalRow}:F${totalRow}`);
      worksheet.mergeCells(`A${totalRow}:F${totalRow}`);
      
      // Gộp lại vùng Ký tên (A-E và F-H) - Dòng 19 gốc nay là 19 + offset
      const sigHeaderRow = 19 + rowOffset;
      worksheet.unMergeCells(`A${sigHeaderRow}:E${sigHeaderRow}`);
      worksheet.mergeCells(`A${sigHeaderRow}:E${sigHeaderRow}`);
      worksheet.unMergeCells(`F${sigHeaderRow}:H${sigHeaderRow}`);
      worksheet.mergeCells(`F${sigHeaderRow}:H${sigHeaderRow}`);

      // Gộp lại vùng Tên Pháp Nhân / Khách Hàng (A-E và F-H) - Dòng 20 gốc nay là 20 + offset
      const sigNameRow = 20 + rowOffset;
      worksheet.unMergeCells(`A${sigNameRow}:E${sigNameRow}`);
      worksheet.mergeCells(`A${sigNameRow}:E${sigNameRow}`);
      worksheet.unMergeCells(`F${sigNameRow}:H${sigNameRow}`);
      worksheet.mergeCells(`F${sigNameRow}:H${sigNameRow}`);
    }

    // 2. Điền các ô đơn lẻ (Header/Footer)
    Object.entries(cellData).forEach(([address, data]) => {
      const cell = worksheet.getCell(address);
      if (data === null || data === undefined) return;

      if (typeof data === 'object' && 'value' in data) {
        cell.value = data.value;
        if (data.font) {
            cell.font = { ...cell.font, ...data.font };
        }
      } else {
        cell.value = data;
      }
    });

    // 3. Điền bảng dữ liệu chi tiết
    tableData.forEach((rowData, i) => {
      const currentRow = tableStartRow + i;
      rowData.forEach((val, j) => {
        const cell = worksheet.getRow(currentRow).getCell(j + 1);
        cell.value = val;
        // Copy style từ dòng mẫu cho các dòng chèn thêm
        if (i > 0) {
            const templateCell = worksheet.getRow(tableStartRow).getCell(j + 1);
            cell.style = JSON.parse(JSON.stringify(templateCell.style));
        }
      });
    });

    // 4. Xuất file
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `${filename}.xlsx`);
  } catch (error) {
    console.error("Lỗi khi dùng ExcelJS:", error);
    throw error;
  }
}

/**
 * Đọc File Excel
 */
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
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
    });
}

/**
 * Xuất Excel cơ bản (Dự phòng)
 */
export function exportToExcel(data: any[], filename: string, sheetName: string = "Sheet1") {
   const xlsx = require('xlsx');
   const ws = xlsx.utils.json_to_sheet(data);
   const wb = xlsx.utils.book_new();
   xlsx.utils.book_append_sheet(wb, ws, sheetName);
   xlsx.writeFile(wb, `${filename}.xlsx`);
}
