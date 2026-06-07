CREATE OR REPLACE VIEW "vStockPrice" AS
SELECT DISTINCT
  ii."itmName",
  ii."itmCode",
  COALESCE(p."Price_ListPrice", 0) AS "Rate",
  ii."itmUOM",
  ii."ID"
FROM "Item_Information" ii
LEFT OUTER JOIN "t_Price" p
  ON ii."itmCode" = TRIM(p."Price_ItemOId")
WHERE COALESCE(p."Price_IsActive", 1) = 1;

CREATE OR REPLACE VIEW "vNCDaily" AS
SELECT
  sp."itmName",
  nd."NCDet_QTY" AS "Qty",
  sp."itmCode",
  sp."itmUOM",
  nm."NCMstr_Date" AS "Date",
  nm."BranchId",
  ii."itmCategory",
  nm."NCMstr_Code" AS "InvNo",
  sp."Rate" * nd."NCDet_QTY" AS "TotalPrice",
  nm."NCMstr_IsActive" AS "IsActive",
  nm."NCMstr_CreationDate" AS "CreateDate"
FROM "t_NCMstr" nm
INNER JOIN "t_NCDet" nd ON nm."NCMstr_OID" = nd."NCDet_MStrOID"
INNER JOIN "Item_Information" ii ON nd."NCDet_ItemOID" = ii."ID"
INNER JOIN "vStockPrice" sp ON nd."NCDet_ItemOID" = sp."ID";

CREATE OR REPLACE VIEW "vCSDaily" AS
SELECT
  ii."itmCode",
  ii."itmName",
  SUM(cd."Qty") AS "Qty",
  ii."itmCategory",
  ii."itmUOM",
  cm."ClientCode",
  cd."Rate" AS "Price",
  SUM(cd."Disc") AS "Discount",
  SUM(cd."vat") AS "Vat",
  SUM(cd."total") AS "TotalPrice",
  cm."InvDate" AS "Date",
  cm."InvNo",
  cm."BranchId",
  cm."IsActive",
  cm."CreateDate",
  '' AS "BankName"
FROM "CSMaster" cm
INNER JOIN "CSDetail" cd ON cm."InvNo" = cd."InvNo"
INNER JOIN "Item_Information" ii ON CAST(cd."ItemOId" AS uuid) = ii."ID"
GROUP BY ii."itmCode", ii."itmName", ii."itmCategory", ii."itmUOM",
  cm."ClientCode", cd."Rate", cm."InvDate", cm."InvNo",
  cm."BranchId", cm."IsActive", cm."CreateDate";

CREATE OR REPLACE VIEW "vSODaily" AS
SELECT
  ii."itmCode",
  ii."itmName",
  SUM(sd."SODet_QTY") AS "Qty",
  ii."itmCategory",
  ii."itmUOM",
  sd."SODet_Price" AS "Price",
  SUM(sd."SODet_Discount") AS "Discount",
  SUM(sd."SODet_VATValue") AS "Vat",
  SUM(sd."SODet_NetAmount") AS "TotalPrice",
  sm."Mtype" AS "ClientCode",
  sm."SOMstr_Date" AS "Date",
  sm."SOMstr_Code" AS "InvNo",
  sm."BranchId",
  sm."SOMstr_IsActive" AS "IsActive",
  sm."SOMstr_CreationDate" AS "CreateDate",
  b."Name" AS "BankName"
FROM "t_SOMstr" sm
INNER JOIN "t_SODet" sd ON sm."SOMstr_OID" = sd."SODet_MStrOID"
INNER JOIN "Item_Information" ii ON sd."SODet_ItemOID" = ii."ID"
LEFT OUTER JOIN "Bank" b ON sm."SoMstr_MBank" = b."ID"
GROUP BY ii."itmCode", ii."itmName", ii."itmCategory", ii."itmUOM",
  sd."SODet_Price", sm."SOMstr_Date", sm."SOMstr_Code", sm."BranchId",
  sm."SOMstr_IsActive", sm."SOMstr_CreationDate", sm."Mtype", b."Name";

CREATE OR REPLACE VIEW "vSalesQty" AS
SELECT
  "itmName", "itmCode",
  SUM(0) AS "ReceiveQty", SUM("Qty") AS "SalesQty", SUM(0) AS "SalesPrice",
  SUM(0) AS "AssortQty", SUM(0) AS "OtherQty", SUM(0) AS "NcQty",
  SUM(0) AS "Reject", SUM(0) AS "Excess", SUM(0) AS "Short",
  "Date", "BranchId", "IsActive"
FROM (
  SELECT "itmName", "itmCode", SUM("Qty") AS "Qty", "Date", "BranchId",
    CASE WHEN "IsActive" THEN 1 ELSE 0 END AS "IsActive"
  FROM "vSODaily" GROUP BY "itmName", "itmCode", "Date", "BranchId", "IsActive"
  UNION ALL
  SELECT "itmName", "itmCode", SUM("Qty") AS "Qty", "Date", "BranchId", "IsActive"
  FROM "vCSDaily" GROUP BY "itmName", "itmCode", "Date", "BranchId", "IsActive"
) AS tbl
GROUP BY "itmName", "itmCode", "Date", "BranchId", "IsActive";

CREATE OR REPLACE VIEW "vSalesPrice" AS
SELECT
  "itmName", "itmCode",
  SUM("ReceiveQty") AS "ReceiveQty", SUM("SalesQty") AS "SalesQty",
  SUM("SalesPrice") AS "SalesPrice", SUM("AssortQty") AS "AssortQty",
  SUM("IssueQty") AS "IssueQty", SUM("NcQty") AS "NcQty",
  SUM("Reject") AS "Reject", SUM("Excess") AS "Excess", SUM("Short") AS "Short",
  "Date", "BranchId", "IsActive"
FROM (
  SELECT "itmName", "itmCode", SUM(0) AS "ReceiveQty", SUM("Qty") AS "SalesQty",
    SUM("TotalPrice") AS "SalesPrice", SUM(0) AS "AssortQty", SUM(0) AS "IssueQty",
    SUM(0) AS "NcQty", SUM(0) AS "Reject", SUM(0) AS "Excess", SUM(0) AS "Short",
    "Date", "BranchId", CASE WHEN "IsActive" THEN 1 ELSE 0 END AS "IsActive"
  FROM "vSODaily" GROUP BY "itmName", "itmCode", "Date", "BranchId", "IsActive"
  UNION ALL
  SELECT "itmName", "itmCode", SUM(0) AS "ReceiveQty", SUM("Qty") AS "SalesQty",
    SUM("TotalPrice") AS "SalesPrice", SUM(0) AS "AssortQty", SUM(0) AS "IssueQty",
    SUM(0) AS "NcQty", SUM(0) AS "Reject", SUM(0) AS "Excess", SUM(0) AS "Short",
    "Date", "BranchId", "IsActive"
  FROM "vCSDaily" GROUP BY "itmName", "itmCode", "Date", "BranchId", "IsActive"
) AS tbl
GROUP BY "itmName", "itmCode", "Date", "BranchId", "IsActive";

CREATE OR REPLACE VIEW "vAsDaily" AS
SELECT
  ii."itmCode", ii."itmName", ii."itmCategory", ii."itmUOM",
  'Cash' AS "ClientCode",
  ad."QTY", ad."Price", ad."Discount",
  ad."VATAmount" AS "Vat",
  ad."NetAmount" AS "TotalPrice",
  am."Date", am."Code" AS "InvNo",
  am."BranchId", am."Type", am."IsActive"
FROM "Item_Information" ii
INNER JOIN "AsstDet" ad ON ii."ID" = ad."ItemOID"
INNER JOIN "AsstMsrt" am ON ad."AsstMsrt_id" = am."id";

CREATE OR REPLACE VIEW "vAssortQty" AS
SELECT
  "itmName", "itmCode",
  SUM(0) AS "ReceiveQty", SUM(0) AS "SalesQty", SUM(0) AS "SalesPrice",
  SUM("QTY") AS "AssortQty", SUM(0) AS "OtherQty", SUM(0) AS "NcQty",
  SUM(0) AS "Reject", SUM(0) AS "Excess", SUM(0) AS "Short",
  "BranchId", "Date", "IsActive"
FROM "vAsDaily"
GROUP BY "itmName", "itmCode", "BranchId", "Type", "Date", "IsActive"
HAVING "Type" = 'Assort';

CREATE OR REPLACE VIEW "vOtherQty" AS
SELECT
  "itmName", "itmCode",
  SUM(0) AS "ReceiveQty", SUM(0) AS "SalesQty", SUM(0) AS "SalesPrice",
  SUM(0) AS "AssortQty", SUM("QTY") AS "OtherQty", SUM(0) AS "NcQty",
  SUM(0) AS "Reject", SUM(0) AS "Excess", SUM(0) AS "Short",
  "BranchId", "Date", "IsActive"
FROM "vAsDaily"
GROUP BY "itmName", "itmCode", "BranchId", "Type", "Date", "IsActive"
HAVING "Type" = 'other';

CREATE OR REPLACE VIEW "vNcQty" AS
SELECT
  "itmName", "itmCode",
  SUM(0) AS "ReceiveQty", SUM(0) AS "SalesQty", SUM(0) AS "SalesPrice",
  SUM(0) AS "AssortQty", SUM(0) AS "IssueQty", SUM("Qty") AS "NcQty",
  SUM(0) AS "Reject", SUM(0) AS "Excess", SUM(0) AS "Short",
  "BranchId", "Date", "IsActive"
FROM "vNCDaily"
GROUP BY "itmName", "itmCode", "BranchId", "Date", "IsActive";

CREATE OR REPLACE VIEW "vItemIssue" AS
SELECT
  ii."itmCode", ii."itmName",
  SUM(iss."Qty") AS "Qty",
  ii."itmCategory", ii."itmUOM",
  sp."Rate" * iss."Qty" AS "Price",
  SUM(0) AS "Discount", SUM(0) AS "Vat",
  SUM(sp."Rate" * iss."Qty") AS "TotalPrice",
  'Cash' AS "ClientCode",
  iss."IssueDate" AS "Date",
  iss."SerialNo" AS "InvNo",
  iss."IssueBranchId" AS "BranchId"
FROM "Item_Information" ii
INNER JOIN "vStockPrice" sp ON ii."itmCode" = sp."itmCode"
INNER JOIN "Item_Issue" iss ON ii."itmCode" = iss."ItemCode"
GROUP BY ii."itmCode", ii."itmName", ii."itmCategory", ii."itmUOM",
  sp."Rate" * iss."Qty", iss."IssueDate", iss."SerialNo", iss."IssueBranchId";

CREATE OR REPLACE VIEW "vIssueQty" AS
SELECT
  "itmName", "itmCode",
  SUM(0) AS "ReceiveQty", SUM(0) AS "SalesQty", SUM(0) AS "SalesPrice",
  SUM(0) AS "AssortQty", SUM("Qty") AS "IssueQty", SUM(0) AS "NcQty",
  SUM(0) AS "Reject", SUM(0) AS "Excess", SUM(0) AS "Short",
  "BranchId", "Date", 1 AS "IsActive"
FROM "vItemIssue"
GROUP BY "itmName", "itmCode", "BranchId", "Date";

CREATE OR REPLACE VIEW "vItemReceive" AS
SELECT
  ii."itmName",
  ir."ItemCode" AS "itmCode",
  SUM(ir."Qty") AS "ReceiveQty",
  SUM(0) AS "SalesQty", SUM(0) AS "SalesPrice",
  SUM(0) AS "AssortQty", SUM(0) AS "IssueQty", SUM(0) AS "NcQty",
  SUM(0) AS "Reject", SUM(0) AS "Excess", SUM(0) AS "Short",
  ir."Pur_Date" AS "Date",
  ir."BranchId",
  ir."IsActive"
FROM "Item_Receive" ir
INNER JOIN "Item_Information" ii ON ir."ItemCode" = ii."itmCode"
GROUP BY ir."Pur_Date", ir."ItemCode", ii."itmName", ir."BranchId", ir."IsActive";

CREATE OR REPLACE VIEW "vItemReject" AS
SELECT
  ii."itmName", ii."itmCode",
  SUM(0) AS "ReceiveQty", SUM(0) AS "SalesQty", SUM(0) AS "SalesPrice",
  SUM(rej."Assort") AS "AssortQty", SUM(0) AS "IssueQty", SUM(0) AS "NcQty",
  SUM(rej."Reject") AS "Reject",
  SUM(rej."Excess") AS "Excess",
  SUM(rej."Short") AS "Short",
  rej."BranchId", rej."Date", rej."IsActive"
FROM "ItemReject" rej
INNER JOIN "Item_Information" ii ON rej."itmOId" = ii."ID"
GROUP BY ii."itmName", ii."itmCode", rej."BranchId", rej."Date", rej."IsActive";

CREATE OR REPLACE VIEW "vRw_Stock" AS
SELECT
  "itmCode" AS "ItemCode",
  SUM("ReceiveQty" - "SalesQty" - "AssortQty" - "IssueQty" - "NcQty" - "Reject" + "Excess" - "Short") AS "Qty"
FROM (
  SELECT "itmCode", "ReceiveQty", "SalesQty", "SalesPrice", "AssortQty", "IssueQty", "NcQty", "Reject", "Excess", "Short", "Date" FROM "vItemReceive"
  UNION ALL
  SELECT "itmCode", "ReceiveQty", "SalesQty", "SalesPrice", "AssortQty", "IssueQty", "NcQty", "Reject", "Excess", "Short", "Date" FROM "vSalesPrice"
  UNION ALL
  SELECT "itmCode", "ReceiveQty", "SalesQty", "SalesPrice", "AssortQty", "IssueQty", "NcQty", "Reject", "Excess", "Short", "Date" FROM "vIssueQty"
  UNION ALL
  SELECT "itmCode", "ReceiveQty", "SalesQty", "SalesPrice", "AssortQty", "IssueQty", "NcQty", "Reject", "Excess", "Short", "Date" FROM "vNcQty"
  UNION ALL
  SELECT "itmCode", "ReceiveQty", "SalesQty", "SalesPrice", "AssortQty", "IssueQty", "NcQty", "Reject", "Excess", "Short", "Date" FROM "vItemReject"
) AS tbl
GROUP BY "itmCode";

CREATE OR REPLACE VIEW "vSalePriceNew" AS
SELECT
  "itmName", "itmCode",
  SUM("ReceiveQty") AS "ReceiveQty", SUM("SalesQty") AS "SalesQty",
  SUM("SalesPrice") AS "SalesPrice", SUM("AssortQty") AS "AssortQty",
  SUM("OtherQty") AS "OtherQty", SUM("NcQty") AS "NcQty",
  SUM("Reject") AS "Reject", SUM("Excess") AS "Excess", SUM("Short") AS "Short",
  "Date", "BranchId", SUM("TotalVat") AS "TotalVat", "IsActive"
FROM (
  SELECT "itmName", "itmCode", SUM(0) AS "ReceiveQty", SUM("Qty") AS "SalesQty",
    SUM("TotalPrice") AS "SalesPrice", SUM(0) AS "AssortQty", SUM(0) AS "OtherQty",
    SUM(0) AS "NcQty", SUM(0) AS "Reject", SUM(0) AS "Excess", SUM(0) AS "Short",
    "Date", "BranchId", SUM("Vat") AS "TotalVat",
    CASE WHEN "IsActive" THEN 1 ELSE 0 END AS "IsActive"
  FROM "vSODaily" GROUP BY "itmName", "itmCode", "Date", "BranchId", "Vat", "IsActive"
  UNION ALL
  SELECT "itmName", "itmCode", SUM(0) AS "ReceiveQty", SUM("Qty") AS "SalesQty",
    SUM("TotalPrice") AS "SalesPrice", SUM(0) AS "AssortQty", SUM(0) AS "OtherQty",
    SUM(0) AS "NcQty", SUM(0) AS "Reject", SUM(0) AS "Excess", SUM(0) AS "Short",
    "Date", "BranchId", SUM("Vat") AS "TotalVat", "IsActive"
  FROM "vCSDaily" GROUP BY "itmName", "itmCode", "Date", "BranchId", "Vat", "IsActive"
) AS tbl
GROUP BY "itmName", "itmCode", "Date", "BranchId", "IsActive";

CREATE OR REPLACE VIEW "vDailyDiscount" AS
SELECT SUM("Discount") AS "Discount", "Date", "BranchId", "IsActive"
FROM (
  SELECT "Discount", "Date", "BranchId", CASE WHEN "IsActive" THEN 1 ELSE 0 END AS "IsActive" FROM "vSODaily"
  UNION ALL
  SELECT "Discount", "Date", "BranchId", "IsActive" FROM "vCSDaily"
) AS tbl
GROUP BY "Date", "BranchId", "IsActive";

CREATE OR REPLACE VIEW "Relazitation" AS
SELECT
  "ClientCode",
  "PaymentDate" AS "TDate",
  SUM("PaymentAmount") AS "Reliazation",
  0 AS "SaleAmount"
FROM "Client_Transaction"
GROUP BY "ClientCode", "PaymentDate";

CREATE OR REPLACE VIEW "SaleAmount" AS
SELECT
  "ClientCode",
  "InvDate" AS "TDate",
  0 AS "Reliazation",
  "TotalAmount" - "TotalDiscount" AS "SaleAmount",
  "IsActive"
FROM "CSMaster"
GROUP BY "ClientCode", "InvDate", "TotalAmount" - "TotalDiscount", "IsActive";

CREATE OR REPLACE VIEW "Balance" AS
SELECT "ClientCode", "TDate", "Reliazation", "SaleAmount",
  "SaleAmount" - "Reliazation" AS "Balance"
FROM (
  SELECT "ClientCode", "TDate", "Reliazation", "SaleAmount" FROM "SaleAmount"
  UNION ALL
  SELECT "ClientCode", "TDate", "Reliazation", "SaleAmount" FROM "Relazitation"
) AS tbl;

CREATE OR REPLACE VIEW "NetPaid" AS
SELECT
  0 AS "SaleAmount",
  "ClientCode",
  "PaymentDate" AS "InvDate",
  SUM("PaymentAmount") AS "PaidAmount"
FROM "Client_Transaction"
GROUP BY "ClientCode", "PaymentDate";

CREATE OR REPLACE VIEW "NetSale" AS
SELECT
  SUM("TotalAmount" - "TotalDiscount") AS "SaleAmount",
  "ClientCode",
  "InvDate",
  0 AS "PaidAmount"
FROM "CSMaster"
GROUP BY "ClientCode", "InvDate";

CREATE OR REPLACE VIEW "vCSVDaily" AS
SELECT
  ii."itmCode", ii."itmName",
  SUM(cvd."Qty") AS "Qty",
  ii."itmCategory", ii."itmUOM",
  cvm."ClientCode",
  cvd."Rate" AS "Price",
  SUM(cvd."Disc") AS "Discount",
  SUM(cvd."vat") AS "Vat",
  SUM(cvd."total") AS "TotalPrice",
  cvm."InvDate" AS "Date",
  cvm."InvNo",
  cvm."BranchId"
FROM "CSVMaster" cvm
INNER JOIN "CSVDetail" cvd ON cvm."InvNo" = cvd."InvNo"
INNER JOIN "Item_Information" ii ON CAST(cvd."ItemOId" AS uuid) = ii."ID"
GROUP BY ii."itmCode", ii."itmName", ii."itmCategory", ii."itmUOM",
  cvm."ClientCode", cvd."Rate", cvm."InvDate", cvm."InvNo", cvm."BranchId";

CREATE OR REPLACE VIEW "vSOVDaily" AS
SELECT
  ii."itmCode", ii."itmName",
  SUM(sv."SODet_QTY") AS "Qty",
  ii."itmCategory", ii."itmUOM",
  sv."SODet_Price" AS "Price",
  SUM(sv."SODet_Discount") AS "Discount",
  SUM(sv."SODet_VATValue") AS "Vat",
  SUM(sv."SODet_NetAmount") AS "TotalPrice",
  'Cash' AS "ClientCode",
  smv."SOMstr_Date" AS "Date",
  smv."SOMstr_Code" AS "InvNo",
  smv."BranchId"
FROM "t_SOMstV" smv
INNER JOIN "t_SODeV" sv ON smv."SOMstr_OID" = sv."SODet_MStrOID"
INNER JOIN "Item_Information" ii ON sv."SODet_ItemOID" = ii."ID"
GROUP BY ii."itmCode", ii."itmName", ii."itmCategory", ii."itmUOM",
  sv."SODet_Price", smv."SOMstr_Date", smv."SOMstr_Code", smv."BranchId";

CREATE OR REPLACE VIEW "vStockCostPrice" AS
SELECT
  ii."itmName", ii."itmCode",
  COALESCE(cp."Price_ListPrice", 0) AS "Rate",
  ii."itmUOM", ii."ID"
FROM "Item_Information" ii
LEFT OUTER JOIN "t_CostPr" cp
  ON ii."itmCode" = TRIM(cp."Price_ItemOId")
WHERE NOW() >= cp."Price_FromDate" AND NOW() <= cp."Price_ToDate";
