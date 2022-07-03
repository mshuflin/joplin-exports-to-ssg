import joplin from 'api';
import { MenuItemLocation,SettingItemType } from 'api/types';
import { Console } from 'console';

const fs = (joplin as any).require('fs-extra');
const path = require('path');

//---------creates title for note as required in jekyll
function titleCreator( title : string ) {
	let today = new Date();
	let fPart = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate() + '-';
	let sPart = title.split(' ').join('-');
	return (fPart + sPart);
};
//---------writes front matter to file-------------
async function wrapper_note(note,AdditionalfrontMatter:string){
	//alert("wrapper_note"+note.id);
	let tagitems = await joplin.data.get(['notes',note.id,'tags'], { fields: ['id', 'title'] });
	//alert(tagitems);
	let layout = 'post';
    for (let i = 0; i < tagitems.items.length; i++) {
		if (tagitems.items[i].title === 'page') {
			layout = 'page';
		}
	}
	let taglist = '[';
	for( var i = 0; i < tagitems.items.length; i++ ) {
		if (tagitems.items[i].title === 'page' || tagitems.items[i].title === 'post') {
			continue;
		}
		taglist += tagitems.items[i].title + ',';
	}
	let create_time=new Date(note.created_time);
	let update_time=new Date(note.updated_time);
	taglist+=']';
	let frontmatter = `---\n`;
	frontmatter += `layout: ${layout}\n`;
	frontmatter += `title: ${note.title}\n`;
	frontmatter += `date: ${create_time.toISOString()}\n`;
	frontmatter += `last_modified_at: ${update_time.toISOString()}\n`;
	frontmatter += `tags: ${taglist}\n`;
	frontmatter +=AdditionalfrontMatter;
	frontmatter += `---\n`;
	note.body=frontmatter+note.body;
	//alert(note.body);
};
//---------collecting and transfering the static file
async function resourceFetcher(note, resourceDir: string, destPath: string , ssg ) {
	const { items } = await joplin.data.get(['notes', note.id, 'resources'] , { fields: ['id', 'title', 'file_extension']} );
	for( var i = 0; i < items.length; i++ ) {
		const resource = items[i];
		const ext = resource.file_extension;
		const srcPath = path.join(resourceDir, `${resource.id}.${ext}`);
		const dest_Path = path.join(destPath, resource.title)
		await fs.copy(srcPath, dest_Path);
		if (ssg === 'hugo') {
			note.body = note.body.replace( `:/${resource.id}`,  `/resources/${resource.title}` );
		} else if (ssg === 'gatsby') {
			note.body = note.body.replace( `:/${resource.id}`,  path.join('..', '..', 'static' , `${resource.title}`));
		} else if (ssg === 'jekyll') {
			note.body = note.body.replace( `:/${resource.id}`, path.join('..', 'resources', `${resource.title}`));
		}
	};
};
function firstline(body:string){
	let firstline=body.split('\n')[0];
	return firstline;
}

joplin.plugins.register({
	onStart: async function () {
		const resourceDir = await joplin.settings.globalValue('resourceDir');

		/*******************Dialog Configurations*******************/
		const dialogs = joplin.views.dialogs;
		const ssg_dialog = await dialogs.create('SSG-Dialog');
		//---------setting dailog UI
		await dialogs.setHtml(ssg_dialog, `
				<div class="dialog" >
				<div class="dialog-header">
					<h2>Exporting Configuration</h2>
				</div>
				<div class="dialog-main">
					<form id="swg-form" name="basic_info">
						<div class="field">
							<label class="block-element labels" for="frontMatter" >Additional Front Matter Infomations (<span>optional</span>) </label>
							<textarea placeholder="Type front matter here..." class="block-element" id = "frontMatter" rows = 10 cols="20" name="frontMatter"></textarea>
						</div>
					</form> 
				</div>
			</div>	
					`);
				//---------add the css file for form
		await dialogs.addScript(ssg_dialog, './form.css');

		//---------setting controls of dialog
		await dialogs.setButtons(ssg_dialog, [
			{
				id: 'submit',
				title : 'Export',
			},
			{
				id: 'cancel',
				title:'Cancel'
			}
		]);
		//---------add the css file for form
		await dialogs.addScript(ssg_dialog, './form.css');

		//---------setting controls of dialog
		await dialogs.setButtons(ssg_dialog, [
			{
				id: 'submit',
				title : 'Export',
			},
			{
				id: 'cancel',
				title:'Cancel'
			}
		]);

		//Register settings		
		await joplin.settings.registerSection('Jekyll output Settings', {
			description: 'Setting default exporting options for Jekyll',
			label: 'Jekyll output Settings',
		});
		await  joplin.settings.registerSettings({
			'SSGType':{
				public: true,
				section: 'Jekyll output Settings',
				type: SettingItemType.String,
				isEnum: true,
				label:'SSG Type',
				options: {
					'hugo': 'Hugo',
					'gatsby': 'Gatsby',
					'jekyll': 'Jekyll',
				},
				value:'jekyll',
			},
			'DefaultJekyllOutputPath': {
				public: true,
				section: 'Jekyll output Settings',
				type: SettingItemType.String,
				label: 'Output paths',
				value:'DefaultJekyllOutputPath',
			}
		});
		/*******************Exporting Code*******************/
		await joplin.commands.register({
            name: 'exportingProcedure',
			execute: async (...args) => {
				//---------prequesite variables
				let export_ssg_type = await joplin.settings.value('SSGType');
				let exportDir=await joplin.settings.value('DefaultJekyllOutputPath');
				//alert(exportDir);
				//alert(export_ssg_type);
				let ssg = export_ssg_type;
				let dest_Path = exportDir;
				let AdditionalfrontMatter = args[1].basic_info.frontMatter;
				if (ssg === 'hugo' || ssg === 'gatsby') {
					const basketFolder = await joplin.data.get(['folders', args[0]], { fields: ['id', 'title', 'body'] });
					const { items } = await joplin.data.get(['notes'], { fields: ['id', 'title', 'body', 'parent_id','created_time','updated_time'] });
					const filteredNotes = items.filter( note => {
						return (note.parent_id === args[0]);
					});

					if (ssg === 'hugo') {
						//---------handle exporting into hugo
						const folderName = basketFolder.title + '-' + basketFolder.id ;
						await fs.mkdirp(path.join(dest_Path, 'content', folderName));//markdown

						await fs.mkdirp(path.join(dest_Path, 'static' , 'resources'));//static'

						const resourceDestPath = (path.join(dest_Path, 'static' ,'resources'));

						for (var i = 0; i < filteredNotes.length; i++) {
							const note = filteredNotes[i];
							await resourceFetcher(note, resourceDir, resourceDestPath, ssg);
							await wrapper_note(note, AdditionalfrontMatter);
							//note.body = frontMatter + '\n' + note.body;
							fs.writeFile(path.join(dest_Path, 'content', folderName, `${note.title}.md`), note.body);
						};
					} else if (ssg === 'gatsby') {
						//---------handle exporting into gatsby
						await fs.mkdirp(path.join(dest_Path, 'src', 'markdown'));//markdown
						fs.readdir(path.join(dest_Path, 'static'), async err => {
							if (err) {
								await fs.mkdirp( path.join( dest_Path , 'static' ) );//static
							}						
						const resourceDestPath = (path.join(dest_Path, 'static'));
						for (var i = 0; i < filteredNotes.length; i++) {
							const note = filteredNotes[i];
							await resourceFetcher(note, resourceDir, resourceDestPath, ssg);
							await wrapper_note(note, AdditionalfrontMatter);
							//note.body = frontMatter + '\n' + note.body;
							fs.writeFile(path.join(dest_Path, 'src', 'markdown', `${note.title}-${note.id}.md`), note.body);
						};
					});
					}
				}
				else if (ssg === 'jekyll') {
					//alert("jkeyll!");
					//---------handle exporting into jekyll
					// 获取所有笔记
					var { items } = await joplin.data.get(['notes'], { fields: ['id', 'title', 'body', 'parent_id','created_time','updated_time'] });
					//alert(JSON.stringify(items));
					const notes=items;
					// 获取所有文件夹
					var { items }  = await joplin.data.get(['folders'], { fields: ['id', 'title', 'parent_id'] });
					const folders=items;
					let foldersJsonString=JSON.stringify(folders);
					//alert(foldersJsonString);
					// 获取所有相关联的文件夹
					// id2folders
					const id2folders = {};
					folders.forEach(folder => {
						id2folders[folder.id] = folder;
					}
					);
					//alert(JSON.stringify(id2folders));
					// FolderParentsTable
					const FolderParentsTable = {};
					folders.forEach(folder => {
						FolderParentsTable[folder.id] = [];
						let pfolder=folder;
						while (pfolder !== undefined) {
							FolderParentsTable[folder.id].push(pfolder.parent_id);
							pfolder = id2folders[pfolder.parent_id];
						}						
						FolderParentsTable[folder.id]=FolderParentsTable[folder.id].filter(item=>(item!==undefined && item!==null && item!==''));
					}
					);
					//alert(JSON.stringify(FolderParentsTable));
					// 获取所有笔记的父文件夹
					const note2folders = {};
					notes.forEach(note => {
						note2folders[note.id] = [];
						if (note.parent_id !== undefined) 
						{
							note2folders[note.id].push(note.parent_id);
							if (id2folders[note.parent_id] !== undefined) {
							FolderParentsTable[note.parent_id].forEach(folder_id => {	
								note2folders[note.id].push(folder_id);
							});}
						}
					} 
					);
					//alert("note2folders"+JSON.stringify(note2folders));
					// All notes relative to folder with id = args[0]
					const filteredNotes = notes.filter( note => {
						return (note2folders[note.id].includes(args[0]));
					}
					);
					//alert("filteredNotes"+JSON.stringify(filteredNotes));
					//notes2tags
					const notes2tags = {};
					for(var i=0;i<filteredNotes.length;i++){
						let note=filteredNotes[i];
						notes2tags[note.id]=[];
						var {items}=await joplin.data.get(['notes',note.id,'tags'], { fields: ['id', 'title'], where: { note_id: note.id } });
						let tags=items;
						//alert(note.id+"tags"+JSON.stringify(items));
						for(var j=0;j<tags.length;j++){
							notes2tags[note.id].push(tags[j].title);
						}
					}
					//alert("notes2tags"+JSON.stringify(notes2tags));
					const SettingTag="settings";
					const PageTag="pages";
					const PostTag="posts";
					fs.readdir(path.join(dest_Path, '_posts'), async (err, files) => {
						if (err) {
							await fs.mkdirp( path.join( dest_Path , '_posts' ) );//markdowns
						}
						await fs.mkdirp(path.join(dest_Path, 'resources'));//static files

						const resourceDestPath = (path.join(dest_Path , 'resources'));
						//alert(filteredNotes.length);
						for(var i = 0; i < filteredNotes.length; i++) {
							const note = filteredNotes[i];
							await resourceFetcher( note , resourceDir , resourceDestPath , ssg  );
							if (notes2tags[note.id].includes(SettingTag)) {
								//alert("Settings"+note.id);
								let first=firstline(note.body)
								let SettingPath=first;
								//alert("SettingPath"+SettingPath);
								fs.writeFile(path.join(dest_Path , SettingPath),note.body.replace(first+'\n',""));
							}else if (notes2tags[note.id].includes(PageTag)) {
							//alert("Pages"+note.id);
							//alert(filteredNotes.length);
							const layout = 'page';
							let taglist='[';
							notes2tags[note.id].forEach(tag => {
								if (tag===SettingTag) {}
								else if (tag===PageTag) {}
								else if (tag===PostTag) {}
								else{
									taglist+=`"${tag}",`;
								}	
							}
							);
							taglist+=']';
							let create_time=new Date(note.created_time);
							let update_time=new Date(note.updated_time);
							let SubDist='';
							for (var j=note2folders[note.id].indexOf(args[0])-1;j>=0;j--) {
								SubDist+=`${id2folders[note2folders[note.id][j]].title}/`;
							}
							let frontmatter = `---\n`;
							frontmatter += `layout: ${layout}\n`;
							frontmatter += `title: ${note.title}\n`;
							frontmatter += `date: ${create_time.toISOString()}\n`;
							frontmatter += `last_modified_at: ${update_time.toISOString()}\n`;
							frontmatter += `tags: ${taglist}\n`;
							frontmatter +=AdditionalfrontMatter;
							frontmatter += `---\n`;
							note.body=frontmatter+note.body;
							//alert(SubDist)
							await fs.mkdirp( path.join( dest_Path , SubDist ) );
							fs.writeFile(path.join(dest_Path , SubDist , `${note.title}.md`), note.body);
							}
							else{
							// wrapper_note
							const layout = 'post';
							let taglist='[';
							notes2tags[note.id].forEach(tag => {
								if (tag===SettingTag) {}
								else if (tag===PageTag) {}
								else if (tag===PostTag) {}
								else{
									taglist+=`"${tag}",`;
								}	
							}
							);
							note2folders[note.id].forEach(folder_id => {
								if (folder_id===args[0]) {
								}else{
								const folder = id2folders[folder_id];
								taglist+=`"${folder.title}",`;}
							}
							);
							taglist+=']';
							let create_time=new Date(note.created_time);
							let update_time=new Date(note.updated_time);
							let frontmatter = `---\n`;
							frontmatter += `layout: ${layout}\n`;
							frontmatter += `title: ${note.title}\n`;
							frontmatter += `date: ${create_time.toISOString()}\n`;
							frontmatter += `last_modified_at: ${update_time.toISOString()}\n`;
							frontmatter += `tags: ${taglist}\n`;
							frontmatter +=AdditionalfrontMatter;
							frontmatter += `---\n`;
							note.body=frontmatter+note.body;
							//await wrapper_note(note, AdditionalfrontMatter);
							note.title = titleCreator(note.title);
							fs.writeFile(path.join(dest_Path , '_posts' , `${note.id}.md`), note.body);
							}
						};
					});
                }
            }
		});
		
		/*******************Driver Code*******************/

		//---------respective command for main button
		await joplin.commands.register({
            name: 'staticSiteExporterDialog',
            label: 'Export to SSG',
            execute: async (folderId: string) => {
				const { id, formData } = await dialogs.open(ssg_dialog);
				if (id == "submit") {
                    await joplin.commands.execute('exportingProcedure', folderId , formData);
                }
            },
		});
		
		//---------created main button[entry point to plugin]
		await joplin.views.menuItems.create('Export to SSG', 'staticSiteExporterDialog', MenuItemLocation.FolderContextMenu);
	},
});
