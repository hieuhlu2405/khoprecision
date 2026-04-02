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
        cell.value = data.value;
        if (data.font) cell.font = { ...cell.font, ...data.font };
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
