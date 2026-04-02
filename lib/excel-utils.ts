import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

/**
 * Tiêm dữ liệu vào một file mẫu Excel có sẵn (Dùng ExcelJS để giữ định dạng)
 * @param templateUrl Đường dẫn đến file mẫu (ví dụ: '/templates/mau.xlsx')
 * @param cellData Map các ô cụ thể cần điền (VD: { 'C2': 'Tên Cty', 'A9': 'Khách hàng' })
 * @param tableData Mảng các mảng (Array of Arrays) cho phần bảng kê chi tiết
 * @param tableStartRow Dòng bắt đầu điền bảng (số, ví dụ: 16)
 * @param filename Tên file tải về (không kèm đuôi)
 */
export async function exportWithTemplate(
  templateUrl: string, 
  cellData: Record<string, string | number | null>, 
  tableData: any[][], 
  tableStartRow: number,
  filename: string
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

    // 1. Điền các ô đơn lẻ (Header/Footer)
    Object.entries(cellData).forEach(([address, value]) => {
      const cell = worksheet.getCell(address);
      if (value !== null && value !== undefined) {
        cell.value = value;
      }
    });

    // 2. Điền bảng dữ liệu chi tiết (Bắt đầu từ tableStartRow)
    // Nếu có nhiều hơn 1 dòng dữ liệu, ta cần chèn thêm dòng để không đè lên phần Footer/Signatures
    if (tableData.length > 1) {
      // Chèn thêm (N-1) dòng sau tableStartRow
      worksheet.duplicateRow(tableStartRow, tableData.length - 1, true);
    }

    // Điền dữ liệu vào bảng
    tableData.forEach((rowData, i) => {
      const currentRow = tableStartRow + i;
      rowData.forEach((val, j) => {
        const cell = worksheet.getRow(currentRow).getCell(j + 1); // Cột 1-indexed (A=1)
        cell.value = val;
        // Giữ nguyên format của dòng mẫu (Border, Font) cho các dòng insert thêm
        if (i > 0) {
            const templateCell = worksheet.getRow(tableStartRow).getCell(j + 1);
            cell.style = templateCell.style;
        }
      });
    });

    // 3. Tính Tổng Cộng (Nếu hàng 19 cũ là TỔNG CỘNG thì giờ nó là tableStartRow + tableData.length + offset?)
    // Với template mẫu này, TỔNG CỘNG đang ở dòng 19 (cách 16 là 3 dòng).
    // Tôi sẽ giả định footer cố định hoặc dùng search để tìm text "TỔNG CỘNG" nếu cần.
    // Tạm thời tôi sẽ chỉ điền dữ liệu vào bảng, ExcelJS đã đẩy footer xuống rồi.

    // 4. Xuất file
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `${filename}.xlsx`);
  } catch (error) {
    console.error("Lỗi khi dùng ExcelJS:", error);
    throw error;
  }
}

/**
 * Đọc File Excel (Cho các tính năng Import)
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
            if (rowNumber > 1) { // Giả định bỏ qua header
              rows.push(row.values);
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
 * Xuất Excel cơ bản (Dự phòng nếu template lỗi)
 */
export function exportToExcel(data: any[], filename: string, sheetName: string = "Sheet1") {
   // Vẫn giữ xlsx cho export cơ bản để nhẹ gàng nếu không cần template
   const xlsx = require('xlsx');
   const ws = xlsx.utils.json_to_sheet(data);
   const wb = xlsx.utils.book_new();
   xlsx.utils.book_append_sheet(wb, ws, sheetName);
   xlsx.writeFile(wb, `${filename}.xlsx`);
}
